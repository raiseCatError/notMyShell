/**
 * Paste batches: where a pasted block of shell text can safely be cut into separate commands for a reviewed queue.
 *
 * Only a COMPLETE top-level statement ends at a newline. A newline inside a quote, a heredoc, a `$( )` or `( )` group,
 * an `if`/`for`/`while`/`case`/`function` block (`begin`/`switch`/`end` in Fish), after a trailing `\`, `&&`, `||` or `|`
 * stays inside the statement, and a chain such as `a && b` is one command: splitting it would change what runs.
 * Anything this scanner cannot account for (unterminated quotes, stray closers, constructs it does not model) is not
 * guessed at: the result says why, and the caller offers the paste as one block of text.
 *
 * Each command is the exact characters from the paste (line endings normalised to \n), never re-quoted or trimmed
 * inside. Nothing here runs, resolves or expands anything.
 */
export type BatchShell = 'zsh' | 'bash' | 'fish';

export interface BatchCommand {
  text: string;
  /** 1-based first and last source line (comment lines before a command belong to it). */
  firstLine: number;
  lastLine: number;
}

export type BatchResult = {ok: true; commands: BatchCommand[]} | {ok: false; reason: string};

/** Nesting deeper than this is not a paste to reason about. */
const MAX_DEPTH = 200;
/** Pastes larger than this are one block of text. */
export const MAX_BATCH_CHARACTERS = 1_000_000;

class Unsplittable extends Error {}
const fail = (reason: string): never => { throw new Unsplittable(reason); };

const OPENERS_POSIX = new Set(['if', 'while', 'until', 'for', 'select']);
const CLOSERS_POSIX = new Set(['fi', 'done', 'esac']);
const OPENERS_FISH = new Set(['if', 'while', 'for', 'switch', 'begin', 'function']);
/** zsh constructs with block forms this scanner does not model. */
const UNMODELLED = new Set(['foreach', 'repeat', 'coproc']);
/** Words after which a command can start again. */
const CONTINUES_COMMAND = new Set(['then', 'do', 'else', 'elif', '!', 'time', 'builtin', 'command', 'exec', 'noglob', 'nocorrect', 'sudo']);

export function splitBatch(input: string, shell: BatchShell): BatchResult {
  const text = input.replace(/\r\n?/gu, '\n');
  if (text.length > MAX_BATCH_CHARACTERS) return {ok: false, reason: 'The paste is too large to split safely.'};
  try { return {ok: true, commands: scan(text, shell)}; }
  catch (error) { if (error instanceof Unsplittable) return {ok: false, reason: error.message}; throw error; }
}

function scan(text: string, shell: BatchShell): BatchCommand[] {
  const fish = shell === 'fish';
  const length = text.length;
  const lineStarts = [0];
  for (let index = 0; index < length; index += 1) if (text[index] === '\n') lineStarts.push(index + 1);
  const lineOf = (index: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (lineStarts[mid]! <= index) low = mid; else high = mid - 1; }
    return low + 1;
  };

  /** Index just past a quoted or substituted span that starts at `from`, or fail. */
  const skipSingle = (from: number, escapes: boolean): number => {
    for (let index = from; index < length; index += 1) {
      if (escapes && text[index] === '\\') { index += 1; continue; }
      if (text[index] === '\'') return index + 1;
    }
    return fail('A single quote is never closed.');
  };
  const skipDouble = (from: number, depth: number): number => {
    for (let index = from; index < length; index += 1) {
      const char = text[index]!;
      if (char === '\\') { index += 1; continue; }
      if (char === '"') return index + 1;
      if (char === '$' && text[index + 1] === '(') index = skipGroup(index + 2, ')', depth + 1) - 1;
      else if (char === '$' && text[index + 1] === '{') index = skipGroup(index + 2, '}', depth + 1) - 1;
      else if (char === '`') index = skipBacktick(index + 1) - 1;
    }
    return fail('A double quote is never closed.');
  };
  const skipBacktick = (from: number): number => {
    for (let index = from; index < length; index += 1) {
      if (text[index] === '\\') { index += 1; continue; }
      if (text[index] === '`') return index + 1;
    }
    return fail('A backtick is never closed.');
  };
  /** Past the matching `close` of a `$(`, `${` or `(` group that started before `from`. */
  const skipGroup = (from: number, close: ')' | '}', depth: number): number => {
    if (depth > MAX_DEPTH) fail('The paste nests too deeply to split safely.');
    const open = close === ')' ? '(' : '{';
    for (let index = from; index < length; index += 1) {
      const char = text[index]!;
      if (char === '\\') { index += 1; continue; }
      if (char === '\'') { index = skipSingle(index + 1, fish || text[index - 1] === '$') - 1; continue; }
      if (char === '"') { index = skipDouble(index + 1, depth) - 1; continue; }
      if (char === '`') { index = skipBacktick(index + 1) - 1; continue; }
      if (char === '$' && text[index + 1] === '(') { index = skipGroup(index + 2, ')', depth + 1) - 1; continue; }
      if (char === '$' && text[index + 1] === '{') { index = skipGroup(index + 2, '}', depth + 1) - 1; continue; }
      if (char === open && close === ')') { index = skipGroup(index + 1, ')', depth + 1) - 1; continue; }
      if (char === close) return index + 1;
    }
    return fail(close === ')' ? 'A parenthesis is never closed.' : 'A brace is never closed.');
  };

  const commands: BatchCommand[] = [];
  const stack: Array<'(' | '{'> = [];
  let blocks = 0;
  let cases = 0;
  let inTest = false;
  let continuation = false;
  let commandStart = true;
  let functionPending = false;
  let statementStart = 0;
  let previousWord = '';
  let sawCode = false;
  const heredocs: Array<{tag: string; strip: boolean}> = [];

  const emit = (end: number) => {
    const raw = text.slice(statementStart, end);
    const trimmed = raw.replace(/^\s+/u, '').replace(/\s+$/u, '');
    if (!trimmed) return;
    const first = statementStart + (raw.length - raw.replace(/^\s+/u, '').length);
    commands.push({text: trimmed, firstLine: lineOf(first), lastLine: lineOf(first + trimmed.length - 1)});
  };
  const complete = () => !continuation && !stack.length && !blocks && !cases && !inTest && !functionPending;
  const nextWordAfterBreak = (from: number): string => {
    let index = from;
    while (index < length) {
      const char = text[index]!;
      if (char === '\n' || char === ' ' || char === '\t') { index += 1; continue; }
      if (char === '#') { while (index < length && text[index] !== '\n') index += 1; continue; }
      break;
    }
    return /^(?:&&|\|\||\||[A-Za-z_][\w-]*)/u.exec(text.slice(index, index + 40))?.[0] ?? '';
  };

  let index = 0;
  while (index < length) {
    const char = text[index]!;
    if (char === '\n') {
      index += 1;
      if (!continuation) commandStart = true;
      if (heredocs.length) {
        // The bodies follow the line that named them; each ends at a line that is exactly its tag.
        for (const heredoc of heredocs.splice(0)) {
          for (;;) {
            if (index >= length) fail('A here-document is never closed.');
            const end = text.indexOf('\n', index);
            const line = text.slice(index, end < 0 ? length : end);
            index = end < 0 ? length : end + 1;
            if ((heredoc.strip ? line.replace(/^\t+/u, '') : line) === heredoc.tag) break;
          }
        }
        if (complete() && sawCode) { emit(index); statementStart = index; sawCode = false; commandStart = true; }
        continue;
      }
      if (complete() && sawCode) {
        const next = nextWordAfterBreak(index);
        if (/^(?:&&|\|\||\|)/u.test(next)) { if (!fish) fail('A line starts with an operator.'); }
        else if (fish && (next === 'and' || next === 'or')) { /* a Fish modifier continues the statement above */ }
        else { emit(index - 1); statementStart = index; sawCode = false; commandStart = true; }
      } else if (!sawCode) {
        // Blank or comment-only lines wait for the command they precede.
      }
      continue;
    }
    if (char === ' ' || char === '\t') { index += 1; continue; }
    if (char === '#') { while (index < length && text[index] !== '\n') index += 1; continue; }
    if (char === '\\') {
      if (text[index + 1] === '\n') { index += 2; continue; }
      sawCode = true; commandStart = false; continuation = false;
      index += 2;
      continue;
    }
    // Operators.
    if (char === '&' && text[index + 1] === '&') { continuation = true; commandStart = true; index += 2; sawCode = true; continue; }
    if (char === '|') {
      continuation = !inTest; commandStart = true; sawCode = true;
      index += text[index + 1] === '|' || text[index + 1] === '&' ? 2 : 1;
      continue;
    }
    if (char === ';') {
      sawCode = true; continuation = false; commandStart = true;
      index += text[index + 1] === ';' ? 2 : 1;
      if (cases && text[index - 1] === ';' && text[index - 2] === ';') { /* end of a case arm */ }
      continue;
    }
    if (char === '&') { sawCode = true; continuation = false; commandStart = true; index += 1; continue; }
    if (char === '(') {
      if (stack.length >= MAX_DEPTH) fail('The paste nests too deeply to split safely.');
      stack.push('('); sawCode = true; continuation = false; commandStart = true; index += 1; continue;
    }
    if (char === ')') {
      if (stack.at(-1) === '(') stack.pop();
      else if (cases) { /* the ) after a case pattern */ }
      else fail('A closing parenthesis has nothing to close.');
      sawCode = true; continuation = false; commandStart = true; index += 1;
      continue;
    }
    if (char === '<' || char === '>') {
      // Redirections; `<<` names a here-document (not in Fish, which has none), `<<<` is a here-string.
      if (!fish && char === '<' && text[index + 1] === '<' && text[index + 2] !== '<' && text[index - 1] !== '<') {
        let at = index + 2;
        const strip = text[at] === '-';
        if (strip) at += 1;
        while (text[at] === ' ' || text[at] === '\t') at += 1;
        const match = /^(?:'([^'\n]*)'|"([^"\n]*)"|\\?([^\s;&|<>()]+))/u.exec(text.slice(at, at + 200));
        if (!match) fail('A here-document has no readable end marker.');
        heredocs.push({tag: (match![1] ?? match![2] ?? match![3])!, strip});
        index = at + match![0].length;
        sawCode = true; continuation = false; commandStart = false;
        continue;
      }
      // Process substitution <( ) and >( ).
      if (text[index + 1] === '(') { index = skipGroup(index + 2, ')', 1); sawCode = true; continuation = false; commandStart = false; continue; }
      sawCode = true; continuation = false; commandStart = false; index += 1;
      continue;
    }
    // A word, possibly with quoted or substituted parts.
    let word = '';
    let plain = true;
    sawCode = true;
    while (index < length) {
      const c = text[index]!;
      if (c === '\n' || c === ' ' || c === '\t' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || c === '<' || c === '>') break;
      if (c === '\\') { if (text[index + 1] === '\n') { index += 2; continue; } plain = false; index += 2; continue; }
      if (c === '\'') { plain = false; index = skipSingle(index + 1, fish || text[index - 1] === '$'); continue; }
      if (c === '"') { plain = false; index = skipDouble(index + 1, 1); continue; }
      if (c === '`') { plain = false; index = skipBacktick(index + 1); continue; }
      if (c === '$' && text[index + 1] === '(') { plain = false; index = skipGroup(index + 2, ')', 1); continue; }
      if (c === '$' && text[index + 1] === '{') { plain = false; index = skipGroup(index + 2, '}', 1); continue; }
      if (c === '#' && word === '' ) break;
      word += c;
      index += 1;
    }
    continuation = false;
    if (!plain || !word) { commandStart = false; functionPending = false; continue; }
    if (commandStart) {
      if (!fish && UNMODELLED.has(word) && shell === 'zsh') fail(`"${word}" blocks are not split.`);
      if (fish) {
        if (OPENERS_FISH.has(word) && !(word === 'if' && previousWord === 'else')) { blocks += 1; if (blocks > MAX_DEPTH) fail('The paste nests too deeply to split safely.'); }
        else if (word === 'end') { if (!blocks) fail('"end" has nothing to close.'); blocks -= 1; }
      } else {
        if (OPENERS_POSIX.has(word)) { blocks += 1; if (blocks > MAX_DEPTH) fail('The paste nests too deeply to split safely.'); }
        else if (word === 'case') { cases += 1; blocks += 1; }
        else if (CLOSERS_POSIX.has(word)) {
          if (!blocks) fail(`"${word}" has nothing to close.`);
          blocks -= 1;
          if (word === 'esac') { if (!cases) fail('"esac" has nothing to close.'); cases -= 1; }
        } else if (word === 'function') functionPending = true;
        else if (word === '[[') inTest = true;
      }
    }
    if (word === '{' && !fish) {
      if (stack.length >= MAX_DEPTH) fail('The paste nests too deeply to split safely.');
      stack.push('{'); functionPending = false; commandStart = true; continue;
    }
    if (word === '}' && !fish && commandStart) {
      if (stack.at(-1) !== '{') fail('A closing brace has nothing to close.');
      stack.pop(); commandStart = false; continue;
    }
    if (word === ']]') inTest = false;
    const wasStart = commandStart;
    commandStart = commandStart && CONTINUES_COMMAND.has(word);
    if (fish && wasStart && (word === 'and' || word === 'or' || word === 'not')) commandStart = true;
    previousWord = wasStart ? word : '';
  }
  if (heredocs.length) fail('A here-document is never closed.');
  if (continuation) fail('The paste ends in the middle of a command.');
  if (stack.length || blocks || cases || inTest) fail('A block or group is never closed.');
  if (sawCode) emit(length);
  else if (commands.length) {
    // Trailing comment lines stay with the command above them.
    const rest = text.slice(statementStart).replace(/\s+$/u, '').replace(/^\n+/u, '');
    if (rest) {
      const last = commands[commands.length - 1]!;
      commands[commands.length - 1] = {text: `${last.text}\n${rest}`, firstLine: last.firstLine, lastLine: lineOf(text.replace(/\s+$/u, '').length - 1)};
    }
  }
  return commands;
}
