import type {Key} from '../terminal/keys.js';
import {renderControlRows} from '../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {isSlashInput, parseSlashCommand} from '../commands/slashCommands.js';
import {classifyCommand, KIND_LABELS, primaryKind, splitCommands, type PasteKind} from './pasteGuard.js';
import {displaySafe} from './PasteReview.js';
import {splitBatch, type BatchCommand, type BatchShell} from './pasteBatch.js';
import {displayWidth, padCells, truncateAnsi, truncateText} from '../util/text.js';

/**
 * Batch Review: a pasted sequence split into the commands the shell would run, to look at before any of it is queued.
 * Nothing runs because it was pasted or shown here. Enter queues exactly the commands listed, in the order listed,
 * into this session's own queue (one at a time, in the same shell, pausing on a failure); every other key leaves the
 * paste as text.
 */
export interface BatchEntry extends BatchCommand {
  kinds: PasteKind[];
}

/** steps: one at a time through the composer, for a list with NMSh commands (QA F02). */
export type BatchChoice = 'block' | 'queue' | 'steps' | 'edit' | 'cancel';
export const BATCH_CHOICES: readonly BatchChoice[] = ['block', 'queue', 'steps', 'edit', 'cancel'];

export interface BatchReviewState {
  /** The paste exactly as it arrived. */
  source: string;
  entries: BatchEntry[];
  /** The reviewed list has been removed from or reordered. Original source remains available via t. */
  modified?: boolean;
  cursor: number;
  /** First visible list row. */
  top: number;
  /** Free places in the session's queue. */
  capacity: number;
  /** Where the commands come from, when not a paste (a recipe): shown in the header. */
  title?: string;
  /** What the commands expect (the recipe's folder and the current one), shown above the list. */
  note?: string;
  /** Active execution choice. */
  choice?: BatchChoice;
  /** Refusal reason if separation into separate commands is refused or unsafe. */
  refusal?: string;
  /** Verified statement count (from parse validation). */
  verifiedCount?: number;
}

export type BatchReviewAction =
  | {kind: 'queue'}
  | {kind: 'steps'}
  | {kind: 'block'}
  | {kind: 'text'}
  | {kind: 'edit'}
  | {kind: 'back'}
  | {kind: 'cancel'};

/** Contents of `$( )`, `<( )`, `>( )` and backtick substitutions in a command (balanced; an approximation that errs towards finding more). */
function substitutions(text: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '`') {
      const end = text.indexOf('`', index + 1);
      if (end < 0) break;
      found.push(text.slice(index + 1, end));
      index = end;
    } else if ((char === '$' || char === '<' || char === '>') && text[index + 1] === '(') {
      let depth = 1;
      let at = index + 2;
      while (at < text.length && depth) { if (text[at] === '(') depth += 1; else if (text[at] === ')') depth -= 1; at += 1; }
      found.push(text.slice(index + 2, depth ? at : at - 1));
      index += 1;
    }
  }
  return found;
}

/**
 * Everything the whole command can do, not just how its first line starts: every statement in it (heredoc bodies
 * and block contents included, which only ever over-reports) and everything inside command substitutions.
 */
export function entryKinds(text: string, depth = 0): PasteKind[] {
  const kinds = new Set<PasteKind>();
  for (const piece of splitCommands(text)) for (const kind of classifyCommand(piece.text, piece.pipedFrom)) kinds.add(kind);
  // A quote the splitter loses track of (an apostrophe in a heredoc, in a comment) must not hide what follows it:
  // every line is classified on its own as well, and every statement after a `;`, `&&`, `||`, `|` or `&`. This only
  // ever adds findings.
  for (const line of text.split('\n')) {
    for (const part of line.split(/&&|\|\||[;|&]/u)) {
      const trimmed = part.trim().replace(/^[{(]\s*/u, '').replace(/^(?:do|then|else)\s+/u, '');
      if (trimmed && !trimmed.startsWith('#')) for (const kind of classifyCommand(trimmed, false)) if (kind !== 'text') kinds.add(kind);
    }
  }
  if (depth < 3) for (const inner of substitutions(text)) for (const kind of entryKinds(inner, depth + 1)) kinds.add(kind);
  return [...kinds];
}

/**
 * A statement that is one of NMSh's own commands (QA F02). The shell would treat `/modules` as a path, and a block that
 * starts with one is not a slash command either, so a list holding one is never run as a block or queued for the shell.
 * Comment lines before it belong to the statement; a slash line inside a heredoc or a quote is the statement's text.
 */
export function isNmshStatement(text: string): boolean {
  const command = text.split('\n').filter(line => !/^\s*#/u.test(line)).join('\n').trim();
  if (!isSlashInput(command)) return false;
  const slash = parseSlashCommand(command);
  return Boolean(slash && slash.kind !== 'unknown');
}

/** Any of the reviewed commands is NMSh's own; a refused paste counts any line that is one by itself. */
export function hasNmshCommand(state: Pick<BatchReviewState, 'entries' | 'refusal'>): boolean {
  return state.entries.some(entry => isNmshStatement(entry.text) || (state.refusal !== undefined && entry.text.split('\n').some(isNmshStatement)));
}

/** The paste as separate commands, when the shell grammar says it safely can be (two or more); undefined means "keep it as one block". */
export function createBatchReview(source: string, shell: BatchShell, capacity: number): BatchReviewState | undefined {
  const result = splitBatch(source, shell);
  if (!result.ok || result.commands.length < 2) return undefined;
  const entries = result.commands.map(command => ({...command, kinds: entryKinds(command.text)}));
  return {source, entries, cursor: 0, top: 0, capacity, choice: hasNmshCommand({entries}) ? 'steps' : 'queue', verifiedCount: result.commands.length};
}

/**
 * Creates a batch review state for multiline paste with execution choices, including when command separation is refused.
 */
export function createBatchReviewWithRefusal(source: string, shell: BatchShell, capacity: number, refusal?: string): BatchReviewState {
  const result = splitBatch(source, shell);
  if (result.ok && result.commands.length >= 2 && !refusal) return createBatchReview(source, shell, capacity)!;
  const lines = source.split('\n');
  const reason = refusal ?? (result.ok ? 'It is a single command.' : result.reason);
  const entries = [{text: source, firstLine: 1, lastLine: lines.length, kinds: entryKinds(source)}];
  return {
    source,
    entries,
    cursor: 0,
    top: 0,
    capacity,
    // A block holding an NMSh command line is never offered to the shell as one: only Edit and Cancel remain.
    choice: hasNmshCommand({entries, refusal: reason}) ? 'edit' : 'block',
    refusal: reason,
    verifiedCount: result.ok ? result.commands.length : 1,
  };
}

/** The choice Enter acts on. A list with NMSh commands only ever has its own choices; otherwise as before. */
function activeChoice(state: BatchReviewState, choices: readonly BatchChoice[]): BatchChoice {
  const choice = state.choice ?? (state.refusal ? 'block' : 'queue');
  return hasNmshCommand(state) && !choices.includes(choice) ? choices[0]! : choice;
}

/** Available execution choices for the given batch review state. */
export function batchAvailableChoices(state: BatchReviewState): BatchChoice[] {
  // NMSh's commands run in NMSh, one at a time; the shell (a block, its queue) never gets them.
  if (hasNmshCommand(state)) return state.refusal ? ['edit', 'cancel'] : ['steps', 'edit', 'cancel'];
  const choices: BatchChoice[] = ['block'];
  const canQueue = !state.refusal && state.entries.length >= 2 && state.entries.length <= state.capacity;
  if (canQueue) choices.push('queue');
  choices.push('edit', 'cancel');
  return choices;
}

/** A reviewed list of commands that are already separate (a recipe's steps): the same review, queue and safety. */
export function batchFromCommands(commands: readonly string[], capacity: number, details: {title: string; note?: string}): BatchReviewState {
  const entries = commands.map((text, index): BatchEntry => ({text, firstLine: index + 1, lastLine: index + 1, kinds: entryKinds(text)}));
  return {
    source: commands.join('\n'),
    entries,
    cursor: 0,
    top: 0,
    capacity,
    choice: 'queue',
    verifiedCount: commands.length,
    title: details.title,
    ...(details.note ? {note: details.note} : {}),
  };
}

/** Why a paste is not offered as a batch (for the review's own note), or undefined when it is. */
export function batchRefusal(source: string, shell: BatchShell): string | undefined {
  const result = splitBatch(source, shell);
  if (!result.ok) return result.reason;
  return result.commands.length < 2 ? 'It is a single command.' : undefined;
}

export function batchReviewKey(state: BatchReviewState, key: Key, height: number): BatchReviewAction | undefined {
  const rows = listRows(height);
  const last = state.entries.length - 1;
  const select = (to: number) => { state.cursor = Math.max(0, Math.min(last, to)); };
  const move = (by: number) => {
    const to = state.cursor + by;
    if (to < 0 || to > last) return;
    const [entry] = state.entries.splice(state.cursor, 1);
    state.entries.splice(to, 0, entry!);
    state.cursor = to;
    state.modified = true;
  };

  const choices = batchAvailableChoices(state);
  const currentChoice = activeChoice(state, choices);
  const cycleChoice = (step: number) => {
    let idx = choices.indexOf(currentChoice);
    if (idx === -1) idx = 0;
    state.choice = choices[(idx + step + choices.length) % choices.length];
  };

  // Choice navigation (Left / Right / Tab / Shift+Tab)
  if (key.kind === 'left' || key.kind === 'focusPrevious') {
    cycleChoice(-1);
    return undefined;
  }
  if (key.kind === 'right' || key.kind === 'complete' || key.kind === 'focusNext') {
    cycleChoice(1);
    return undefined;
  }

  if (key.kind === 'enter') {
    if (currentChoice === 'queue') {
      if (state.refusal) return undefined;
      return state.entries.length && state.entries.length <= state.capacity ? {kind: 'queue'} : undefined;
    }
    if (currentChoice === 'block') return batchBlockText(state).trim() ? {kind: 'block'} : undefined;
    if (currentChoice === 'steps') return state.entries.length ? {kind: 'steps'} : undefined;
    if (currentChoice === 'edit') return {kind: 'edit'};
    if (currentChoice === 'cancel') return {kind: 'cancel'};
    return undefined;
  }

  if (key.kind === 'escape') return {kind: 'back'};
  if (key.kind === 'interrupt') return {kind: 'cancel'};
  if (key.kind === 'up' || key.kind === 'wheelUp') select(state.cursor - 1);
  else if (key.kind === 'down' || key.kind === 'wheelDown') select(state.cursor + 1);
  else if (key.kind === 'pageUp') select(state.cursor - rows);
  else if (key.kind === 'pageDown') select(state.cursor + rows);
  else if (key.kind === 'delete' || key.kind === 'backspace') remove(state);
  else if (key.kind === 'text') {
    const value = key.value.toLowerCase();
    if (value === '1') { if (choices.includes('block') || choices.includes('steps')) state.choice = choices.includes('steps') ? 'steps' : 'block'; return undefined; }
    if (value === '2') {
      if (choices.includes('queue')) state.choice = 'queue';
      return undefined;
    }
    if (value === '3') { state.choice = 'edit'; return undefined; }
    if (value === '4') { state.choice = 'cancel'; return undefined; }
    if (value === 'b') { if (choices.includes('block')) state.choice = 'block'; return undefined; }
    if (value === 'x') remove(state);
    else if (value === 'k') move(-1);
    else if (value === 'j') move(1);
    else if (value === 't') return {kind: 'text'};
    else if (value === 'e' && state.entries.length) return {kind: 'edit'};
    else if (value === 'q' && choices.includes('queue') && state.entries.length && state.entries.length <= state.capacity) return {kind: 'queue'};
    else if (value === 'c') return {kind: 'cancel'};
  }
  state.top = Math.max(0, Math.min(state.top, Math.max(0, state.entries.length - rows)));
  if (state.cursor < state.top) state.top = state.cursor;
  else if (state.cursor >= state.top + rows) state.top = state.cursor - rows + 1;
  return undefined;
}

function remove(state: BatchReviewState): void {
  if (!state.entries.length) return;
  state.entries.splice(state.cursor, 1);
  state.modified = true;
  state.cursor = Math.max(0, Math.min(state.cursor, state.entries.length - 1));
}

/** Exact original block until the list is changed; afterwards only the reviewed survivors, in their shown order. */
export function batchBlockText(state: BatchReviewState): string {
  return state.modified ? batchTexts(state).join('\n') : state.source;
}

/** The commands as they will be queued (the reviewed list, one entry per command). */
export function batchTexts(state: BatchReviewState): string[] {
  return state.entries.map(entry => entry.text);
}

/** A command line as rows of at most `width` cells: wrapped, never cut, so nothing of it is out of sight. */
function wrapRows(line: string, width: number): string[] {
  const rows: string[] = [];
  let row = '';
  let used = 0;
  for (const char of displaySafe(line)) {
    // Characters a terminal may draw wide (ambiguous, combining, emoji) count as two cells, so no row can overflow.
    const cells = Math.max(displayWidth(char), (char.codePointAt(0) ?? 0) > 0xff ? 2 : 1);
    if (used + cells > width && row) { rows.push(row); row = ''; used = 0; }
    row += char;
    used += cells;
  }
  rows.push(row);
  return rows;
}

const FIXED_ROWS = 12;
const listRows = (height: number) => Math.max(1, Math.min(8, height - FIXED_ROWS - 3));
const RISKY: ReadonlySet<PasteKind> = new Set(['destructive', 'privilege', 'pipeline']);

/** At most `height` rows: header, choices, the list (scrolling), the selected command in full, the notes and the controls. */
export function renderBatchReview(state: BatchReviewState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const accent = foreground(UI_COLORS.accent);
  const failure = foreground(UI_COLORS.failure);
  const reset = '\u001B[0m';
  const count = state.entries.length;
  const width = Math.max(10, columns - 4);
  const verifiedStr = state.verifiedCount !== undefined ? ` · ${state.verifiedCount} verified statement${state.verifiedCount === 1 ? '' : 's'}` : '';
  const out: string[] = [`  ${primary}Review commands${reset}  ${subtle}${truncateText(`${state.title ? `${state.title} · ` : ''}${count} command${count === 1 ? '' : 's'}${verifiedStr}, in this order`, Math.max(8, width - 18))}${reset}`];
  if (state.note) out.push(`  ${subtle}${truncateText(state.note, width)}${reset}`);
  if (state.refusal) out.push(`  ${failure}! Separation refused: ${truncateText(state.refusal, Math.max(8, width - 24))}${reset}`);

  // Execution choices bar
  const choices = batchAvailableChoices(state);
  const active = activeChoice(state, choices);
  const compact = columns < 70;
  const choicePills: string[] = [];
  const nmsh = hasNmshCommand(state);
  if (nmsh) {
    out.push(`  ${subtle}${truncateText(state.refusal ? 'It has NMSh commands, which never go to the shell: edit it, or enter them one by one.'
      : 'NMSh commands run in NMSh, not the shell: each command waits in the composer in turn, and runs on your Enter.', width)}${reset}`);
    if (!state.refusal) {
      const stepsLabel = compact ? `1 One at a time (${count})` : `1 One at a time · ${count} command${count === 1 ? '' : 's'}`;
      choicePills.push(active === 'steps' ? `${accent}${GLYPHS.selection} [${stepsLabel}]${reset}` : `${subtle}[${stepsLabel}]${reset}`);
    }
  }

  if (!nmsh) {
    const blockFocused = active === 'block';
    const blockLabel = compact ? '1 Block' : '1 Run as block';
    choicePills.push(blockFocused ? `${accent}${GLYPHS.selection} [${blockLabel} · 1 outer execution]${reset}` : `${subtle}[${blockLabel}]${reset}`);

    const queueFocused = active === 'queue';
    const canQueue = choices.includes('queue');
    if (canQueue) {
      const queueLabel = compact ? `2 Queue (${count})` : `2 Queue separately · ${count} statement${count === 1 ? '' : 's'}`;
      choicePills.push(queueFocused ? `${accent}${GLYPHS.selection} [${queueLabel}]${reset}` : `${subtle}[2 Queue]${reset}`);
    } else {
      choicePills.push(`${subtle}[2 Queue · refused]${reset}`);
    }
  }

  const editFocused = active === 'edit';
  choicePills.push(editFocused ? `${accent}${GLYPHS.selection} [3 Edit]${reset}` : `${subtle}[3 Edit]${reset}`);

  const cancelFocused = active === 'cancel';
  choicePills.push(cancelFocused ? `${accent}${GLYPHS.selection} [4 Cancel]${reset}` : `${subtle}[4 Cancel]${reset}`);

  out.push(`  ${choicePills.join('  ')}`);
  out.push('');

  const rows = listRows(height);
  const numberWidth = String(count).length;
  const labelWidth = columns >= 76 ? 26 : 0;
  if (!count) out.push(`  ${secondary}Nothing left to queue. Esc goes back to the paste.${reset}`);
  for (let index = state.top; index < Math.min(count, state.top + rows); index += 1) {
    const entry = state.entries[index]!;
    const focused = index === state.cursor;
    const kind = primaryKind(entry.kinds);
    const color = RISKY.has(kind) ? failure : kind === 'install' || kind === 'modifies' ? accent : subtle;
    const label = labelWidth ? `${color}${padCells(truncateText(KIND_LABELS[kind], labelWidth - 1), labelWidth)}${reset}` : RISKY.has(kind) ? `${failure}! ${reset}` : '';
    const lines = entry.text.split('\n');
    const first = displaySafe(lines[0]!) + (lines.length > 1 ? `  ⏎ +${lines.length - 1}` : '');
    out.push(truncateAnsi(`${focused ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${subtle}${String(index + 1).padStart(numberWidth)}${reset}  ${label}${focusForeground(focused)}${truncateText(first, Math.max(8, width - numberWidth - labelWidth - 4))}${reset}`, columns));
  }
  if (count > rows) out.push(`  ${subtle}${state.top + 1}–${Math.min(count, state.top + rows)} of ${count}${reset}`);
  const selected = state.entries[state.cursor];
  const notes = 2;

  const actionLabel = active === 'steps'
    ? 'first command to the composer'
    : active === 'block'
    ? 'run as block'
    : active === 'queue'
      ? `queue ${count}`
      : active === 'edit'
        ? 'edit in composer'
        : 'cancel';
  const controls = renderControlRows([['↑↓', 'select'], ['←→/Tab', 'choice'], ['Enter', actionLabel], ['e', 'edit as text'], ['t', 'original text'], ['Esc', 'back']], columns);

  if (active === 'block' && state.entries.length <= 1) {
    out.push('', `  ${subtle}Entire block, exactly as it will run as 1 outer execution${reset}`);
    const wrapped = batchBlockText(state).split('\n').flatMap(line => wrapRows(line, Math.max(8, width - 4)));
    const room = Math.max(2, height - out.length - notes - controls.length - 1);
    const shown = wrapped.length > room ? room - 1 : room;
    for (const row of wrapped.slice(0, shown)) out.push(`    ${secondary}${row}${reset}`);
    if (wrapped.length > shown) out.push(`    ${failure}… ${wrapped.length - shown} more row${wrapped.length - shown === 1 ? "" : "s"} hidden; still part of the command${reset}`);
  } else if (selected) {
    const kind = primaryKind(selected.kinds);
    out.push('', `  ${subtle}Command ${state.cursor + 1}, exactly as it will be queued${reset}${RISKY.has(kind) || kind === 'install' || kind === 'modifies' ? `${RISKY.has(kind) ? failure : accent} · ${KIND_LABELS[kind]} somewhere in it${reset}` : ''}`);
    const wrapped = selected.text.split('\n').flatMap(line => wrapRows(line, Math.max(8, width - 4)));
    const room = Math.max(2, height - out.length - notes - controls.length - 1);
    const shown = wrapped.length > room ? room - 1 : room;
    for (const row of wrapped.slice(0, shown)) out.push(`    ${secondary}${row}${reset}`);
    if (wrapped.length > shown) out.push(`    ${failure}… ${wrapped.length - shown} more row${wrapped.length - shown === 1 ? "" : "s"} hidden; still part of the command${reset}`);
  }
  out.push('');
  if (active === 'block') {
    out.push(`  ${subtle}${truncateText('Nothing runs until you press Enter. The shell runs 1 outer execution.', width)}${reset}`);
  } else if (active === 'edit') {
    out.push(`  ${subtle}${truncateText('Press Enter to open this text in the composer for editing. Nothing will be executed.', width)}${reset}`);
  } else if (active === 'cancel') {
    out.push(`  ${subtle}${truncateText('Press Enter to cancel and discard this paste. Nothing will be executed.', width)}${reset}`);
  } else if (count > state.capacity) {
    out.push(`  ${failure}${truncateText(`The queue has room for ${state.capacity} more; remove ${count - state.capacity} to queue these.`, width)}${reset}`);
  } else {
    out.push(`  ${subtle}${truncateText('Nothing runs until you press Enter. Then the shell runs them one at a time, and the queue stops if one fails.', width)}${reset}`);
  }
  out.push(...controls.map(row => `  ${row}`));
  const fixed = Math.max(4, height);
  return (out.length > fixed ? [...out.slice(0, fixed - 1), out[out.length - 1]!] : out).map(row => truncateAnsi(row, columns));
}
