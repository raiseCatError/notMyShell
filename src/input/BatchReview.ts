import type {Key} from '../terminal/keys.js';
import {renderControlRows} from '../ui/controls.js';
import {renderTabStrip, selectedRowBand} from '../ui/PanelShell.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {isSlashInput, parseSlashCommand} from '../commands/slashCommands.js';
import {classifyCommand, KIND_LABELS, primaryKind, splitCommands, type PasteKind} from './pasteGuard.js';
import {displaySafe} from './PasteReview.js';
import {splitBatch, type BatchCommand, type BatchShell} from './pasteBatch.js';
import {displayWidth, padCells, truncateAnsi, truncateText} from '../util/text.js';

/**
 * Batch Review: a pasted sequence split into the commands the shell (or NMSh) would run, to look at before any of it
 * runs. Nothing runs because it was pasted or shown here. The mode strip chooses how: One at a time (each command
 * waits in the composer for its own Enter), Queue all (one confirmation, then they run in order and the sequence stops
 * on a failure) or Run as block (a shell-only paste, one original submission). Enter confirms the chosen mode; every
 * other key leaves the paste as text. Drawn with the shared tab strip, selection band and control rows.
 */
export interface BatchEntry extends BatchCommand {
  kinds: PasteKind[];
}

/**
 * steps: One at a time, through the composer. queue: Queue all, run in order after one confirmation. block: Run as
 * block, a shell-only paste as one original submission.
 */
export type BatchChoice = 'steps' | 'queue' | 'block' | 'edit' | 'cancel';
export const BATCH_CHOICES: readonly BatchChoice[] = ['steps', 'queue', 'block', 'edit', 'cancel'];

/** The labels of the mode strip; `b`, `q` and `o` select, Enter confirms. */
export const BATCH_LABELS: Readonly<Record<BatchChoice, string>> = {steps: 'One at a time', queue: 'Queue all', block: 'Run as block', edit: 'Edit', cancel: 'Cancel'};

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
  /** Why Queue all is not offered when the session cannot queue (queueing off, an older service). */
  queueOff?: string;
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

/** The statement's command with its leading comment lines removed: what NMSh dispatches. */
export function nmshCommandText(text: string): string {
  return text.split('\n').filter(line => !/^\s*#/u.test(line)).join('\n').trim();
}

/**
 * A statement that is one of NMSh's own commands (QA F02). The shell would treat `/modules` as a path, and a block that
 * starts with one is not a slash command either, so a list holding one is never run as a block or queued for the shell.
 * Comment lines before it belong to the statement; a slash line inside a heredoc or a quote is the statement's text.
 */
export function isNmshStatement(text: string): boolean {
  const command = nmshCommandText(text);
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
  // Nothing executes by default: the conservative first mode is One at a time, where each command still waits for Enter.
  return {source, entries, cursor: 0, top: 0, capacity, choice: 'steps', verifiedCount: result.commands.length};
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
    // A paste that cannot be separated offers Run as block (a shell-only paste), Edit and Cancel; Edit is the default
    // so that Enter alone never runs anything.
    choice: 'edit',
    refusal: reason,
    verifiedCount: result.ok ? result.commands.length : 1,
  };
}

/** The most commands in a row that go to the shell's queue at once (NMSh commands are dispatched in NMSh, between them). */
export function longestShellRun(entries: readonly Pick<BatchEntry, 'text'>[]): number {
  let longest = 0;
  let run = 0;
  for (const entry of entries) {
    if (isNmshStatement(entry.text)) run = 0;
    else { run += 1; longest = Math.max(longest, run); }
  }
  return longest;
}

/** Queue all is possible: separated commands, a queue that is on, and room for the longest run of shell commands. */
function canQueueAll(state: BatchReviewState): boolean {
  return !state.refusal && !state.queueOff && state.entries.length >= 1 && longestShellRun(state.entries) <= state.capacity;
}

/** Available execution choices for the given batch review state, in the order the mode strip shows them. */
export function batchAvailableChoices(state: BatchReviewState): BatchChoice[] {
  const choices: BatchChoice[] = [];
  if (!state.refusal && state.entries.length) choices.push('steps');
  if (canQueueAll(state)) choices.push('queue');
  // NMSh's own commands never reach the shell, so a list holding one is never one block either.
  if (!hasNmshCommand(state) && batchBlockText(state).trim()) choices.push('block');
  choices.push('edit', 'cancel');
  return choices;
}

/** The choice Enter acts on: the chosen one when it is offered, otherwise the first offered. */
function activeChoice(state: BatchReviewState, choices: readonly BatchChoice[]): BatchChoice {
  return state.choice && choices.includes(state.choice) ? state.choice : choices[0]!;
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
    // A recipe is a saved, named sequence the person chose to run: its review keeps Queue all first.
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
  // What Enter does is what the strip shows: a mode that stopped being offered (no room left) falls back visibly.
  if (state.choice && !choices.includes(state.choice)) state.choice = choices[0];
  const currentChoice = activeChoice(state, choices);
  const cycleChoice = (step: number) => {
    const idx = Math.max(0, choices.indexOf(currentChoice));
    state.choice = choices[(idx + step + choices.length) % choices.length];
  };
  const choose = (choice: BatchChoice) => { if (choices.includes(choice)) state.choice = choice; };

  // Mode navigation (Left / Right / Tab / Shift+Tab)
  if (key.kind === 'left' || key.kind === 'focusPrevious') {
    cycleChoice(-1);
    return undefined;
  }
  if (key.kind === 'right' || key.kind === 'complete' || key.kind === 'focusNext') {
    cycleChoice(1);
    return undefined;
  }

  if (key.kind === 'enter') {
    if (currentChoice === 'steps') return state.entries.length ? {kind: 'steps'} : undefined;
    if (currentChoice === 'queue') return canQueueAll(state) ? {kind: 'queue'} : undefined;
    if (currentChoice === 'block') return batchBlockText(state).trim() ? {kind: 'block'} : undefined;
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
    // Digits pick the nth mode shown; letters pick a mode by name. Only Enter confirms one that can run something.
    if (/^[1-9]$/u.test(value)) { const picked = choices[Number(value) - 1]; if (picked) state.choice = picked; return undefined; }
    if (value === 'o') { choose('steps'); return undefined; }
    if (value === 'q') { choose('queue'); return undefined; }
    if (value === 'b') { choose('block'); return undefined; }
    if (value === 'x') remove(state);
    else if (value === 'k') move(-1);
    else if (value === 'j') move(1);
    else if (value === 't') return {kind: 'text'};
    else if (value === 'e' && state.entries.length) return {kind: 'edit'};
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

/** Words as rows of at most `width` cells (a quiet note that wraps rather than being cut). */
function wrapWords(text: string, width: number): string[] {
  const rows: string[] = [];
  let row = '';
  for (const word of text.split(' ')) {
    if (row && displayWidth(row) + 1 + displayWidth(word) > width) { rows.push(row); row = word; }
    else row = row ? `${row} ${word}` : word;
  }
  if (row) rows.push(row);
  return rows.map(item => truncateText(item, width));
}

const FIXED_ROWS = 12;
const listRows = (height: number) => Math.max(1, Math.min(8, height - FIXED_ROWS - 3));
const RISKY: ReadonlySet<PasteKind> = new Set(['destructive', 'privilege', 'pipeline']);

/** What the chosen mode will do on Enter, and what it is not offered for, in one quiet line each. */
function modeNotes(state: BatchReviewState, active: BatchChoice, choices: readonly BatchChoice[]): string[] {
  const count = state.entries.length;
  const nmsh = hasNmshCommand(state);
  const notes: string[] = [];
  if (active === 'steps') notes.push(nmsh ? 'Each waits in the composer for your Enter; NMSh commands run in NMSh, not the shell.' : 'Each waits in the composer for your Enter; the next is offered after it.');
  else if (active === 'queue') notes.push(nmsh
    ? `Enter confirms all ${count}: they run in order, NMSh commands in NMSh and the rest in the shell; it stops on a failure.`
    : `Enter confirms all ${count}: they run in order in this shell, and the queue stops if one fails.`);
  else if (active === 'block') notes.push('1 submission. Shells may read a block differently than line by line.');
  else if (active === 'edit') notes.push('Enter opens this text in the composer for editing. Nothing is executed.');
  else notes.push('Enter discards this paste. Nothing is executed.');
  if (!choices.includes('block') && !state.refusal && nmsh) notes.push('Run as block is off: NMSh commands never go to the shell as a block.');
  if (!choices.includes('queue') && !state.refusal) {
    notes.push(state.queueOff ?? (count ? `Queue all is off: the queue has room for ${state.capacity} more shell commands.` : ''));
  }
  return notes.filter(Boolean);
}

/** At most `height` rows: header, mode strip, the list (scrolling), the selected command in full, the notes and the controls. */
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

  // The mode strip: the shared tab strip, so the active mode is the same lavender block as Settings' active tab.
  const choices = batchAvailableChoices(state);
  const active = activeChoice(state, choices);
  const compact = columns < 70;
  const label = (choice: BatchChoice) => (choice === 'steps' && !compact ? `One at a time · ${count}` : choice === 'queue' && !compact ? `Queue all · ${count}` : BATCH_LABELS[choice]);
  out.push('');
  out.push(renderTabStrip(choices.map(label), choices.indexOf(active), columns, true));
  for (const note of modeNotes(state, active, choices)) for (const row of wrapWords(note, width).slice(0, 2)) out.push(`  ${subtle}${row}${reset}`);
  out.push('');

  const rows = listRows(height);
  const numberWidth = String(count).length;
  const labelWidth = columns >= 76 ? 26 : 0;
  if (!count) out.push(`  ${secondary}Nothing left to run. Esc goes back to the paste.${reset}`);
  for (let index = state.top; index < Math.min(count, state.top + rows); index += 1) {
    const entry = state.entries[index]!;
    const focused = index === state.cursor;
    const nmshEntry = isNmshStatement(entry.text);
    const kind = primaryKind(entry.kinds);
    const color = nmshEntry ? accent : RISKY.has(kind) ? failure : kind === 'install' || kind === 'modifies' ? accent : subtle;
    const kindName = nmshEntry ? 'NMSh command' : KIND_LABELS[kind];
    const tag = labelWidth ? `${color}${padCells(truncateText(kindName, labelWidth - 1), labelWidth)}${reset}` : RISKY.has(kind) ? `${failure}! ${reset}` : '';
    const lines = entry.text.split('\n');
    const first = displaySafe(lines[0]!) + (lines.length > 1 ? `  ⏎ +${lines.length - 1}` : '');
    const row = `${focused ? GLYPHS.selection : ' '} ${subtle}${String(index + 1).padStart(numberWidth)}${reset}  ${tag}${focused ? '' : focusForeground(false)}${truncateText(first, Math.max(8, width - numberWidth - labelWidth - 4))}${reset}`;
    out.push(focused ? selectedRowBand(` ${row}`, columns) : truncateAnsi(` ${row}`, columns));
  }
  if (count > rows) out.push(`  ${subtle}${state.top + 1}–${Math.min(count, state.top + rows)} of ${count}${reset}`);
  const selected = state.entries[state.cursor];

  const actionLabel = active === 'steps' ? 'first to the composer'
    : active === 'queue' ? `queue all ${count}`
    : active === 'block' ? 'run as block'
    : active === 'edit' ? 'edit in composer'
    : 'cancel';
  const controls = renderControlRows([['↑↓', 'select'], ['←→/Tab', 'mode'], ['Enter', actionLabel], ['e', 'edit as text'], ['t', 'original text'], ['Esc', 'back']], columns);
  const notesRoom = 1;

  if (active === 'block' && state.entries.length <= 1) {
    out.push('', `  ${subtle}Entire block, exactly as it will run as 1 outer execution${reset}`);
    const wrapped = batchBlockText(state).split('\n').flatMap(line => wrapRows(line, Math.max(8, width - 4)));
    const room = Math.max(2, height - out.length - notesRoom - controls.length - 1);
    const shown = wrapped.length > room ? room - 1 : room;
    for (const row of wrapped.slice(0, shown)) out.push(`    ${secondary}${row}${reset}`);
    if (wrapped.length > shown) out.push(`    ${failure}… ${wrapped.length - shown} more row${wrapped.length - shown === 1 ? '' : 's'} hidden; still part of the command${reset}`);
  } else if (selected) {
    const kind = primaryKind(selected.kinds);
    const nmshEntry = isNmshStatement(selected.text);
    const risk = RISKY.has(kind) || kind === 'install' || kind === 'modifies';
    out.push('', `  ${subtle}Command ${state.cursor + 1}, exactly as it will run${reset}${nmshEntry ? `${accent} · NMSh runs this itself${reset}` : risk ? `${RISKY.has(kind) ? failure : accent} · ${KIND_LABELS[kind]} somewhere in it${reset}` : ''}`);
    const wrapped = selected.text.split('\n').flatMap(line => wrapRows(line, Math.max(8, width - 4)));
    const room = Math.max(2, height - out.length - notesRoom - controls.length - 1);
    const shown = wrapped.length > room ? room - 1 : room;
    for (const row of wrapped.slice(0, shown)) out.push(`    ${secondary}${row}${reset}`);
    if (wrapped.length > shown) out.push(`    ${failure}… ${wrapped.length - shown} more row${wrapped.length - shown === 1 ? '' : 's'} hidden; still part of the command${reset}`);
  }
  out.push('');
  out.push(`  ${subtle}${truncateText('Nothing runs until you press Enter on a mode.', width)}${reset}`);
  out.push(...controls.map(row => `  ${row}`));
  const fixed = Math.max(4, height);
  return (out.length > fixed ? [...out.slice(0, fixed - 1), out[out.length - 1]!] : out).map(row => truncateAnsi(row, columns));
}
