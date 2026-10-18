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

/** What the program is reading, for a wait that left no question on its line. */
export function inputReading(request: InputRequest, program: string): string {
  const what = request.mode === 'hidden' ? 'hidden input' : request.mode === 'key' ? 'a single key' : 'a line';
  return request.confidence === 'likely' ? `${program} is probably reading ${what}` : `${program} is reading ${what}`;
}

/**
 * The composer's one instruction while a program waits: what to do and where Enter goes, said once (the activity
 * rows carry the state and the question). Hidden input never shows what is typed, not even as dots.
 */
export function inputComposerHint(request: InputRequest, program: string, queue: boolean): string {
  const queueing = queue ? ' · Ctrl+Q queues a command' : '';
  if (request.confidence === 'confirmed' && request.mode === 'hidden') return `Hidden input · nothing you type is shown · Enter sends it to ${program}${queueing}`;
  if (request.confidence === 'confirmed' && request.mode === 'key') return `Press a key · it goes straight to ${program}${queueing}`;
  return `Type your answer · Enter sends it to ${program}${queueing}`;
}

/**
 * The two rows of the live activity region while a command waits: the attention line (headline, program, how long
 * it has waited, and the total when it differs) and the question it left open, or what it reads when it left none.
 * Fits `columns` by dropping the least important parts first.
 */
export function inputActivityRows(state: InputState & {request: InputRequest}, command: string, startedAt: number, now: number, columns: number): [string, string] {
  const request = state.request;
  const program = inputProgram(request, command);
  const attention = foreground(UI_COLORS.attention);
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  // The wait comes from the session's clock and the total from this frontend's: never show a wait longer than the run.
  const total = Math.max(0, now - startedAt);
  const waitedMs = Math.min(Math.max(0, now - request.since), total);
  const waiting = formatDuration(waitedMs);
  const showTotal = total - waitedMs >= 1000;
  const head = `${inputGlyph(request)} ${inputHeadline(request)}`;
  const tails = [[program, waiting, ...(showTotal ? [`${formatDuration(total)} total`] : [])], [program, waiting], [waiting]];
  const tail = tails.find(parts => displayWidth(`${head} · ${parts.join(' · ')}`) <= columns) ?? [];
  const first = `${attention}${BOLD}${truncateText(head, columns)}${RESET}${tail.length ? `${secondary} · ${tail.join(' · ')}${RESET}` : ''}`;
  const indent = '  ';
  const room = Math.max(1, columns - displayWidth(indent));
  // The program's own question, as it wrote it; without one, what it is reading. How to answer is the composer's.
  const second = request.prompt ? `${indent}${primary}${BOLD}${truncateText(request.prompt, room)}${RESET}`
    : `${indent}${secondary}${truncateText(inputReading(request, program), room)}${RESET}`;
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
