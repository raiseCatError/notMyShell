import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateText} from '../util/text.js';
import {classifyCommand, isClassified, type Classification} from './detector.js';

/**
 * The background suggestion (#382): a strip above the composer, shown when a
 * submitted command belongs to a recognized family and the person has not
 * decided for that family. It is not a modal: Enter runs the command in the
 * foreground exactly as it would have run (so pressing Enter twice is the
 * old behavior), and the strip says what running in the background changes.
 *
 *   b  background once     Enter  run here (foreground)
 *   a  always background   n      don't ask for this family
 *   Esc  back to the draft, unchanged
 */

export type SuggestionChoice = 'background' | 'foreground' | 'always' | 'never' | 'edit';

export interface Suggestion {
  command: string;
  classification: Classification;
}

export function suggestionKey(key: Key): SuggestionChoice | undefined {
  if (key.kind === 'enter') return 'foreground';
  if (key.kind === 'escape') return 'edit';
  if (key.kind !== 'text') return undefined;
  return ({b: 'background', a: 'always', n: 'never'} as const)[key.value as 'b' | 'a' | 'n'];
}

/** One or two rows: what the command does and the choices; the second row names what a background run does not inherit. */
export function renderSuggestion(suggestion: Suggestion, options: {width: number; color: boolean; safe: boolean}): string[] {
  const width = Math.max(1, options.width);
  const reset = options.color ? '\u001b[0m' : '';
  const paint = (text: string, color: {red: number; green: number; blue: number}, bold = false) => options.color ? `${bold ? '\u001b[1m' : ''}${foreground(color)}${text}${reset}` : text;
  const mark = options.safe ? '~' : '↻';
  const likely = suggestion.classification.likelihood === 'likely' ? ' (it may keep running)' : '';
  const choices = 'b background · Enter run here · a always · n don\'t ask · Esc edit';
  const first = `${mark} ${suggestion.classification.reason}${likely}`;
  if (width < 48) return [paint(truncateText(`${mark} ${suggestion.classification.family}: b bg · Enter here`, width), UI_COLORS.accent, true)];
  return [
    paint(truncateText(first, width), UI_COLORS.accent, true),
    paint(truncateText(`${choices} — in the background it runs separately, without this shell's aliases, functions or unexported variables`, width), UI_COLORS.subtle),
  ];
}

export type ExplicitRun = {ok: true; command: string; classification?: Classification; notes: string[]} | {ok: false; reason: string};

/**
 * `/background run <command>`: the person chose background execution explicitly. The command text after `run ` is kept
 * byte for byte. Programs that need the terminal or the person's input are refused (they would wait forever on a
 * task's terminal nobody sees); everything else runs, with notes when it depends on things a separate shell does not
 * have.
 */
export function explicitRun(input: string): ExplicitRun {
  const match = /^\/(?:background|bg)[ \t]+run[ \t]+([\s\S]+)$/u.exec(input);
  if (!match) return {ok: false, reason: 'usage: /background run <command>'};
  const command = match[1]!.replace(/^[ \t]+/u, '');
  const result = classifyCommand(command);
  if (!isClassified(result) && /needs the terminal|NMSh command/u.test(result.why)) return {ok: false, reason: `not run in the background: ${result.why}`};
  const notes: string[] = [];
  if (!isClassified(result) && /expansion|substitution/u.test(result.why)) notes.push('expansions run in a separate shell: values set only in this shell are not seen');
  if (!isClassified(result) && /several lines|command list|background job|subshell/u.test(result.why)) notes.push('runs as one script in a separate shell');
  return {ok: true, command, ...(isClassified(result) ? {classification: result} : {}), notes};
}

export type BackgroundCommand =
  | {kind: 'open'}
  | {kind: 'run'; input: string}
  | {kind: 'stop'; taskId: string; force: boolean}
  | {kind: 'remove'; taskId: string}
  | {kind: 'clear'}
  | {kind: 'suggestions'; value: 'ask' | 'off'}
  | {kind: 'forget'; family: string}
  | {kind: 'invalid'; reason: string};

/** `/background` and its short form `/bg`. Task ids are NMSh's own (`t3`). */
export function parseBackgroundCommand(input: string): BackgroundCommand | undefined {
  // trimEnd, not `/\s+$/`: the regular expression retries from every space of a long run (a paste), quadratically.
  const match = /^\/(background|bg)(?:[ \t]+([\s\S]*))?$/u.exec(input.trimEnd());
  if (!match) return undefined;
  const rest = (match[2] ?? '').trim();
  if (!rest) return {kind: 'open'};
  const [verb, ...args] = rest.split(/[ \t]+/u);
  switch (verb) {
    case 'run': return {kind: 'run', input};
    case 'stop': case 'kill': {
      const taskId = args[0];
      return taskId && /^t\d{1,6}$/u.test(taskId) ? {kind: 'stop', taskId, force: verb === 'kill'} : {kind: 'invalid', reason: `usage: /background ${verb} t<number>`};
    }
    case 'remove': return args[0] && /^t\d{1,6}$/u.test(args[0]) ? {kind: 'remove', taskId: args[0]} : {kind: 'invalid', reason: 'usage: /background remove t<number>'};
    case 'clear': return {kind: 'clear'};
    case 'suggestions': return args[0] === 'on' || args[0] === 'off' ? {kind: 'suggestions', value: args[0] === 'on' ? 'ask' : 'off'} : {kind: 'invalid', reason: 'usage: /background suggestions on|off'};
    case 'forget': return args.length ? {kind: 'forget', family: args.join(' ')} : {kind: 'invalid', reason: 'usage: /background forget <family>'};
    default: return {kind: 'invalid', reason: `unknown: ${verb!.slice(0, 32)}; try /background run, stop, remove, clear, suggestions, forget`};
  }
}
