import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {basename, dirname, extname, join} from 'node:path';
import {inspectFile, parseJsonc, scanJson, previewDiff, sha256, type FileEditPlan, type FileFacts, type PlanResult} from './fileEdit.js';

/**
 * Small, verified repairs: JSON syntax, an unclosed Python bracket, a missing
 * Python block indent, and formatter commands. A repair is offered only when
 * exactly one minimal candidate fixes the reported problem and the candidate
 * itself passes the same check (parse/compile) before it is proposed. Anything
 * with several plausible fixes is reported, never guessed. This is not a
 * coding agent: semantic changes are out of scope.
 */

export type Checker = (text: string) => {ok: true} | {ok: false; message: string; line?: number};

/** Strict JSON (or JSONC) structure check. */
export function jsonChecker(comments: boolean): Checker {
  return text => {
    const scan = scanJson(text, comments);
    return scan.ok ? {ok: true} : {ok: false, message: scan.error!.message, line: text.slice(0, scan.error!.offset).split('\n').length};
  };
}

/** Python's own compiler when python3 exists (no execution: compile only, from stdin). */
export function pythonChecker(python3: string | undefined): Checker | undefined {
  if (!python3) return undefined;
  return text => {
    const result = spawnSync(python3, ['-c', 'import sys\ntry:\n compile(sys.stdin.read(), "<nmsh>", "exec")\nexcept SyntaxError as e:\n print(e.lineno or 0); print(e.msg); sys.exit(1)'],
      {input: text, encoding: 'utf8', timeout: 5000});
    if (result.status === 0) return {ok: true};
    const [line, message] = (result.stdout ?? '').split('\n');
    return {ok: false, message: message || 'syntax error', line: Number(line) || undefined};
  };
}

function planFrom(facts: FileFacts, after: string, reason: string, format: FileEditPlan['format']): PlanResult {
  const before = facts.content!;
  let start = 0;
  while (start < before.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore -= 1; endAfter -= 1; }
  const edit = {start, end: endBefore, text: after.slice(start, endAfter)};
  const diff = previewDiff(before, after, edit);
  return {kind: 'plan', plan: {path: facts.path, resolvedPath: facts.resolvedPath, symlink: facts.symlink, format, operation: 'replace', edits: [edit],
    expectedSha256: sha256(before), resultSha256: sha256(after), preview: diff.lines, line: diff.line, reason}};
}

/** JSON: try the minimal single-character fixes at the reported error; exactly one that parses is the repair. */
export function repairJson(facts: FileFacts, comments: boolean): PlanResult {
  const text = facts.content!;
  const check = jsonChecker(comments);
  const first = check(text);
  if (first.ok) return {kind: 'noop', reason: `${basename(facts.path)} is already valid JSON${comments ? ' (with comments)' : ''}.`};
  const scan = scanJson(text, comments);
  const at = scan.error!.offset;
  // The end of the previous token: where a missing comma or closer belongs.
  let previous = at;
  while (previous > 0 && /\s/u.test(text[previous - 1]!)) previous -= 1;
  const candidates = new Map<string, string>();
  // The previous token's end first: a fix there is the conventional place for a missing comma or closer.
  for (const position of new Set([previous, at])) {
    for (const insert of [',', '}', ']', ':']) candidates.set(`${insert}@${position}`, text.slice(0, position) + insert + text.slice(position));
    if (position < text.length) candidates.set(`del@${position}`, text.slice(0, position) + text.slice(position + 1));
  }
  // A trailing comma before a closer (strict JSON).
  const trailing = /,(\s*)$/u.exec(text.slice(0, at));
  if (trailing) candidates.set('trailing', text.slice(0, at - trailing[0].length) + trailing[1] + text.slice(at));
  // Unclosed containers at end of file: close them in order, on their own lines.
  if (at >= text.trimEnd().length) {
    const stack: string[] = [];
    let inString = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]!;
      if (inString) { if (char === '\\') index += 1; else if (char === '"') inString = false; continue; }
      if (char === '"') inString = true; else if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']'); else if (char === '}' || char === ']') stack.pop();
    }
    if (stack.length) candidates.set('close', `${text.trimEnd()}\n${stack.reverse().join('\n')}\n`);
  }
  // Fixes that mean the same document (same parsed value) are one repair; the first, most conventional, is used.
  const meanings = new Map<string, string>();
  for (const candidate of candidates.values()) {
    if (!check(candidate).ok) continue;
    let meaning: string;
    try { meaning = JSON.stringify(parseJsonc(candidate)); } catch { continue; }
    if (!meanings.has(meaning)) meanings.set(meaning, candidate);
  }
  const working = [...meanings.values()];
  if (working.length !== 1) {
    return {kind: 'refuse', reason: `${basename(facts.path)} has a JSON error at line ${first.line}: ${first.message}. ${working.length ? 'More than one small fix would make it parse, so I won\'t pick one.' : 'No single small fix makes it valid; open it to fix by hand.'}`};
  }
  return planFrom(facts, working[0]!, `fixes the JSON error at line ${first.line} (${first.message})`, comments ? 'jsonc' : 'json');
}

interface Opener {char: string; line: number; offset: number}

/** Python tokens that matter for brackets: strings (incl. triple-quoted) and comments are skipped. */
export function pythonBrackets(text: string): {unclosed: Opener[]; stray: Opener[]} {
  const stack: Opener[] = [];
  const stray: Opener[] = [];
  let line = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '\n') { line += 1; continue; }
    if (char === '#') { while (index < text.length && text[index] !== '\n') index += 1; index -= 1; continue; }
    if (char === '"' || char === '\'') {
      const triple = text.startsWith(char.repeat(3), index);
      const quote = triple ? char.repeat(3) : char;
      index += quote.length;
      while (index < text.length && !text.startsWith(quote, index)) { if (text[index] === '\\') index += 1; if (text[index] === '\n') { if (!triple) break; line += 1; } index += 1; }
      index += quote.length - 1;
      continue;
    }
    if ('([{'.includes(char)) stack.push({char, line, offset: index});
    else if (')]}'.includes(char)) {
      const top = stack.at(-1);
      if (top && '([{'.indexOf(top.char) === ')]}'.indexOf(char)) stack.pop(); else stray.push({char, line, offset: index});
    }
  }
  return {unclosed: stack, stray};
}

const indentOf = (line: string) => /^[ \t]*/u.exec(line)![0];

/**
 * One unclosed Python bracket whose opener ends its line and whose contents
 * are the following more-indented lines: close it right after them, at the
 * opener line's indentation. Anything else (two unclosed, inline opener) is
 * ambiguous and only reported.
 */
export function repairPythonBracket(facts: FileFacts, checker?: Checker): PlanResult {
  const text = facts.content!;
  const {unclosed, stray} = pythonBrackets(text);
  if (stray.length) return {kind: 'refuse', reason: `${basename(facts.path)} has an unmatched "${stray[0]!.char}" at line ${stray[0]!.line}; removing or matching it needs your judgement.`};
  if (!unclosed.length) return {kind: 'noop', reason: `${basename(facts.path)} has no unclosed brackets.`};
  if (unclosed.length > 1) return {kind: 'refuse', reason: `${basename(facts.path)} has ${unclosed.length} unclosed brackets (lines ${unclosed.map(item => item.line).join(', ')}); there are several plausible places to close them, so I won't guess.`};
  const opener = unclosed[0]!;
  const lines = text.split('\n');
  const openerLine = lines[opener.line - 1]!;
  const lineEnd = text.indexOf('\n', opener.offset);
  if (text.slice(opener.offset + 1, lineEnd === -1 ? undefined : lineEnd).replace(/#.*$/u, '').trim() !== '') {
    return {kind: 'refuse', reason: `The "${opener.char}" on line ${opener.line} is unclosed, but its contents continue on the same line, so where it should close isn't clear.`};
  }
  const base = indentOf(openerLine).length;
  let last = opener.line;
  for (let index = opener.line; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    if (indentOf(line).length <= base) break;
    last = index + 1;
  }
  if (last === opener.line) return {kind: 'refuse', reason: `The "${opener.char}" on line ${opener.line} is unclosed and has no indented contents to close after.`};
  const closer = ')]}'['([{'.indexOf(opener.char)]!;
  const after = [...lines.slice(0, last), `${indentOf(openerLine)}${closer}`, ...lines.slice(last)].join('\n');
  if (checker) {
    const result = checker(after);
    if (!result.ok) return {kind: 'refuse', reason: `Closing the "${opener.char}" from line ${opener.line} still leaves a syntax error (${result.message}), so I won't propose it.`};
  } else if (pythonBrackets(after).unclosed.length) return {kind: 'refuse', reason: 'That repair would not balance the brackets.'};
  return planFrom(facts, after, `closes the "${opener.char}" opened on line ${opener.line}`, 'source');
}

/**
 * A block header ("if foo:") followed by a line that is not indented: indent
 * that one line when it is the only possible body (the next line returns to
 * the header's level or lower). Several candidate lines means the block's
 * extent is unclear: ask instead.
 */
export function repairPythonIndent(facts: FileFacts, checker?: Checker): PlanResult {
  const lines = facts.content!.split('\n');
  const unit = /\n( +|\t)\S/u.exec(facts.content!)?.[1] ?? '    ';
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]!;
    if (!/:\s*(?:#.*)?$/u.test(header) || !/^\s*(?:if|elif|else|for|while|def|class|with|try|except|finally|async|match|case)\b/u.test(header)) continue;
    let bodyIndex = index + 1;
    while (bodyIndex < lines.length && !lines[bodyIndex]!.trim()) bodyIndex += 1;
    if (bodyIndex >= lines.length) continue;
    const headerIndent = indentOf(header).length;
    if (indentOf(lines[bodyIndex]!).length > headerIndent) continue;
    let following = bodyIndex + 1;
    while (following < lines.length && !lines[following]!.trim()) following += 1;
    const nextIndent = following < lines.length ? indentOf(lines[following]!).length : -1;
    const bodyIndent = indentOf(lines[bodyIndex]!).length;
    // A following line at the same level could also belong to the body: the block's extent is not clear.
    if (following < lines.length && nextIndent === bodyIndent && !/^\s*(?:elif|else|except|finally)\b/u.test(lines[following]!)) {
      return {kind: 'refuse', reason: `Line ${bodyIndex + 1} should be indented under line ${index + 1}, but line ${following + 1} could belong to that block too. Which lines should be inside it?`};
    }
    const after = [...lines.slice(0, bodyIndex), `${indentOf(header)}${unit}${lines[bodyIndex]!.trimStart()}`, ...lines.slice(bodyIndex + 1)].join('\n');
    if (checker) {
      const result = checker(after);
      if (!result.ok) return {kind: 'refuse', reason: `Indenting line ${bodyIndex + 1} still leaves a syntax error (${result.message}), so I won't propose it.`};
    }
    return planFrom(facts, after, `indents line ${bodyIndex + 1} under the block on line ${index + 1}`, 'source');
  }
  return {kind: 'noop', reason: `I didn't find a block header missing its indented body in ${basename(facts.path)}.`};
}

/* ---------- formatters ---------- */

export interface Formatter {name: string; argv: string[]; note: string}

/** Formatters Ask may run: their exact argv shapes (the file is the last argument). */
export const FORMATTER_ARGV: Readonly<Record<string, string[]>> = {
  ruff: ['ruff', 'format'], black: ['black'], prettier: ['prettier', '--write'], gofmt: ['gofmt', '-w'], rustfmt: ['rustfmt'], 'clang-format': ['clang-format', '-i'],
};

export function formatterAllowed(argv: readonly string[]): boolean {
  const shape = Object.values(FORMATTER_ARGV).find(prefix => prefix.every((part, index) => argv[index] === part) && argv.length === prefix.length + 1);
  return Boolean(shape) && !argv.at(-1)!.startsWith('-');
}

/** Find the project config a formatter would use, walking up to the project root. */
function hasProjectFile(start: string, root: string, names: readonly string[], exists: (path: string) => boolean): boolean {
  for (let directory = start; ; directory = dirname(directory)) {
    if (names.some(name => exists(join(directory, name)))) return true;
    if (directory === root || dirname(directory) === directory) return false;
  }
}

/** The trusted formatter for a file, if it is installed; project configuration decides between candidates. */
export function chooseFormatter(path: string, root: string, which: (name: string) => string | undefined, exists: (path: string) => boolean = existsSync): Formatter | {missing: string[]} | undefined {
  const extension = extname(path).toLowerCase();
  const dir = dirname(path);
  if (extension === '.py') {
    const ruffConfigured = hasProjectFile(dir, root, ['ruff.toml', '.ruff.toml'], exists);
    if (which('ruff')) return {name: 'ruff', argv: [...FORMATTER_ARGV.ruff!, path], note: ruffConfigured ? 'Uses the project\'s Ruff settings.' : 'Formats the whole file with Ruff\'s defaults (pyproject.toml settings apply if present).'};
    if (which('black')) return {name: 'black', argv: [...FORMATTER_ARGV.black!, path], note: 'Formats the whole file with Black (pyproject.toml settings apply if present).'};
    return {missing: ['ruff', 'black']};
  }
  if (/^\.(?:[cm]?[jt]sx?|json|css|scss|md|ya?ml|html)$/u.test(extension)) {
    const configured = hasProjectFile(dir, root, ['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.yaml', '.prettierrc.yml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs'], exists);
    const local = join(root, 'node_modules', '.bin', 'prettier');
    // Without a project Prettier config, reformatting a project with defaults is not what the project chose.
    if (!configured) return undefined;
    if (exists(local) || which('prettier')) return {name: 'prettier', argv: [...FORMATTER_ARGV.prettier!, path], note: 'Uses the project\'s Prettier config.'};
    return {missing: ['prettier']};
  }
  if (extension === '.go') return which('gofmt') ? {name: 'gofmt', argv: [...FORMATTER_ARGV.gofmt!, path], note: 'gofmt has no options; it formats the whole file.'} : {missing: ['gofmt']};
  if (extension === '.rs') return which('rustfmt') ? {name: 'rustfmt', argv: [...FORMATTER_ARGV.rustfmt!, path], note: 'Uses rustfmt.toml if the project has one.'} : {missing: ['rustfmt']};
  if (/^\.(?:c|h|cc|cpp|hpp|m|mm)$/u.test(extension)) {
    if (!hasProjectFile(dir, root, ['.clang-format', '_clang-format'], exists)) return undefined;
    return which('clang-format') ? {name: 'clang-format', argv: [...FORMATTER_ARGV['clang-format']!, path], note: 'Uses the project\'s .clang-format.'} : {missing: ['clang-format']};
  }
  return undefined;
}

export function inspectForRepair(path: string, roots: readonly string[]): FileFacts { return inspectFile(path, roots); }
