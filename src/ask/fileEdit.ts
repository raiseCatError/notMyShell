import {createHash} from 'node:crypto';
import {chmodSync, mkdirSync, lstatSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync, accessSync, constants, unlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import type {ConfigFormat} from './configTargets.js';

/**
 * Verified file edits for Ask. A plan is built from the file's current
 * content (exact spans, occurrence counts, parsed structure) before any
 * command exists; the shown command and NMSh's own Run are both rendered from
 * the plan, and both refuse to write if the file changed since it was read.
 * Only additions, sets and updates: removal is not part of this feature.
 */

export interface FileEdit {start: number; end: number; text: string}

export interface FileEditPlan {
  /** As named to the user (may be a symlink). */
  path: string;
  /** The file actually written. */
  resolvedPath: string;
  symlink: boolean;
  format: ConfigFormat | 'source';
  operation: 'add' | 'set' | 'update' | 'replace' | 'append' | 'create';
  /** Non-overlapping edits against the inspected content (UTF-16 offsets). */
  edits: FileEdit[];
  /** sha256 of the inspected content: the stale-edit precondition. */
  expectedSha256: string;
  /** sha256 the file has after the edit, to verify a Run. */
  resultSha256: string;
  /** Bounded diff lines ("  ", "- ", "+ " prefixes). */
  preview: string[];
  /** First changed line (1-based). */
  line: number;
  /** Re-checked after a Run writes it (repairs). */
  validate?: 'json' | 'jsonc' | 'python';
  reason: string;
}

export type PlanResult =
  | {kind: 'plan'; plan: FileEditPlan}
  | {kind: 'noop'; reason: string}
  | {kind: 'matches'; reason: string; matches: Array<{line: number; preview: string; start: number; end: number}>}
  | {kind: 'refuse'; reason: string};

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const SECRET = /(?:token|password|passwd|secret|api[_-]?key|auth|credential|private[_-]?key)/iu;

/** Reading is bounded: config and source edits never need more. */
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

export interface FileFacts {path: string; resolvedPath: string; symlink: boolean; content?: string; writable: boolean; refusal?: string}

/** What the file is, where a write would land, and whether NMSh may write it (home or project only, never escalating). */
export function inspectFile(path: string, allowedRoots: readonly string[]): FileFacts {
  let symlink = false;
  let resolvedPath = path;
  try { symlink = lstatSync(path).isSymbolicLink(); resolvedPath = realpathSync(path); } catch { return {path, resolvedPath, symlink, writable: false, refusal: 'does not exist'}; }
  // The file is compared in resolved form, so the roots must be too (/tmp and /var are symlinks on macOS).
  const roots = allowedRoots.map(root => { try { return realpathSync(root); } catch { return root; } });
  const inside = (candidate: string) => roots.some(root => candidate === root || candidate.startsWith(`${root}/`));
  if (!inside(resolvedPath)) return {path, resolvedPath, symlink, writable: false, refusal: `is outside your home folder and this project (${resolvedPath}); Ask won't edit it`};
  let content: string | undefined;
  try {
    if (statSync(resolvedPath).size > MAX_EDIT_BYTES) return {path, resolvedPath, symlink, writable: false, refusal: 'is too large for a verified edit'};
    content = readFileSync(resolvedPath, 'utf8');
  } catch { return {path, resolvedPath, symlink, writable: false, refusal: 'cannot be read'}; }
  let writable = true;
  try { accessSync(resolvedPath, constants.W_OK); accessSync(dirname(resolvedPath), constants.W_OK); } catch { writable = false; }
  return {path, resolvedPath, symlink, content, writable, ...(writable ? {} : {refusal: 'is not writable by you; Ask won\'t change permissions or use sudo'})};
}

/* ---------- JSON / JSONC: a comment-aware scanner that records spans, never rewrites the file ---------- */

interface JsonMember {keyStart: number; valueStart: number; valueEnd: number}
interface JsonObjectSpan {open: number; close: number; members: number; lastValueEnd?: number}
export interface JsonScan {ok: boolean; error?: {offset: number; message: string}; members: Map<string, JsonMember[]>; objects: Map<string, JsonObjectSpan>}

const keyOf = (path: readonly string[]) => path.join('\u0000');

export function scanJson(text: string, allowComments: boolean): JsonScan {
  const members = new Map<string, JsonMember[]>();
  const objects = new Map<string, JsonObjectSpan>();
  let index = 0;
  const fail = (message: string): JsonScan => ({ok: false, error: {offset: index, message}, members, objects});
  const skip = (): string | undefined => {
    for (;;) {
      while (index < text.length && /\s/u.test(text[index]!)) index += 1;
      if (text.startsWith('//', index)) {
        if (!allowComments) return 'comments are not allowed in strict JSON';
        while (index < text.length && text[index] !== '\n') index += 1;
      } else if (text.startsWith('/*', index)) {
        if (!allowComments) return 'comments are not allowed in strict JSON';
        const end = text.indexOf('*/', index + 2);
        if (end === -1) return 'unterminated comment';
        index = end + 2;
      } else return undefined;
    }
  };
  const string = (): string | undefined => {
    const start = index;
    index += 1;
    while (index < text.length && text[index] !== '"') { if (text[index] === '\\') index += 1; if (text[index] === '\n') return undefined; index += 1; }
    if (index >= text.length) return undefined;
    index += 1;
    try { return JSON.parse(text.slice(start, index)) as string; } catch { return undefined; }
  };
  const value = (path: string[] | undefined): string | undefined => {
    const error = skip();
    if (error) return error;
    const char = text[index];
    if (char === '{') {
      const open = index;
      index += 1;
      const span: JsonObjectSpan = {open, close: -1, members: 0};
      for (;;) {
        const before = skip();
        if (before) return before;
        if (text[index] === '}') break;
        if (text[index] !== '"') return 'expected a property name';
        const keyStart = index;
        const key = string();
        if (key === undefined) return 'malformed property name';
        const colon = skip();
        if (colon) return colon;
        if (text[index] !== ':') return 'expected ":"';
        index += 1;
        const leading = skip();
        if (leading) return leading;
        const valueStart = index;
        const child = path ? [...path, key] : undefined;
        const nested = value(child);
        if (nested) return nested;
        if (child) {
          const list = members.get(keyOf(child)) ?? [];
          list.push({keyStart, valueStart, valueEnd: index});
          members.set(keyOf(child), list);
        }
        span.members += 1;
        span.lastValueEnd = index;
        const after = skip();
        if (after) return after;
        if (text[index] === ',') {
          index += 1;
          const trailing = skip();
          if (trailing) return trailing;
          if (text[index] === '}') { if (!allowComments) return 'trailing comma'; break; }
          continue;
        }
        if (text[index] === '}') break;
        return 'expected "," or "}"';
      }
      span.close = index;
      index += 1;
      if (path) objects.set(keyOf(path), span);
      return undefined;
    }
    if (char === '[') {
      index += 1;
      for (;;) {
        const before = skip();
        if (before) return before;
        if (text[index] === ']') { index += 1; return undefined; }
        const item = value(undefined);
        if (item) return item;
        const after = skip();
        if (after) return after;
        if (text[index] === ',') { index += 1; const trailing = skip(); if (trailing) return trailing; if (text[index] === ']') { if (!allowComments) return 'trailing comma'; index += 1; return undefined; } continue; }
        if (text[index] === ']') { index += 1; return undefined; }
        return 'expected "," or "]"';
      }
    }
    if (char === '"') return string() === undefined ? 'malformed string' : undefined;
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(index));
    if (!literal) return 'unexpected token';
    index += literal[0].length;
    return undefined;
  };
  const error = value([]);
  if (error) return fail(error);
  const tail = skip();
  if (tail) return fail(tail);
  if (index !== text.length) return fail('unexpected content after the top-level value');
  return {ok: true, members, objects};
}

/** Parse a JSONC fragment's value (comments and trailing commas removed by the scanner's rules). */
export function parseJsonc(text: string): unknown {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') { const start = index; index += 1; while (index < text.length && text[index] !== '"') { if (text[index] === '\\') index += 1; index += 1; } out += text.slice(start, index + 1); continue; }
    if (text.startsWith('//', index)) { while (index < text.length && text[index] !== '\n') index += 1; out += '\n'; continue; }
    if (text.startsWith('/*', index)) { index = text.indexOf('*/', index + 2) + 1; continue; }
    out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/gu, '$1'));
}

function indentUnit(text: string): string {
  const match = /\n([ \t]+)\S/u.exec(text);
  return match?.[1]?.startsWith('\t') ? '\t' : ' '.repeat(Math.min(8, match?.[1]?.length ?? 2));
}
const lineIndentAt = (text: string, offset: number) => /^[ \t]*/u.exec(text.slice(text.lastIndexOf('\n', offset - 1) + 1))![0];
const reindent = (json: string, indent: string) => json.split('\n').map((line, index) => index === 0 ? line : `${indent}${line}`).join('\n');
const deepEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Leaf assignments of a snippet object: {"terminal": {"font_size": 14}} → [["terminal","font_size"], 14]. Arrays are values. */
export function flattenJson(value: unknown, prefix: string[] = []): Array<{path: string[]; value: unknown}> {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flattenJson(child, [...prefix, key]));
  }
  return prefix.length ? [{path: prefix, value}] : [];
}

/** Set one key path in JSON/JSONC text with a minimal span edit; the rest of the file is untouched. */
function setJsonOnce(text: string, path: readonly string[], value: unknown, comments: boolean): {text: string; changed: 'add' | 'update' | 'none'} | {error: string} {
  const scan = scanJson(text, comments);
  if (!scan.ok) return {error: `it isn't valid ${comments ? 'JSON with comments' : 'JSON'} (${scan.error!.message} at line ${text.slice(0, scan.error!.offset).split('\n').length})`};
  if (!scan.objects.has('')) return {error: 'its top level is not an object'};
  const existing = scan.members.get(keyOf(path)) ?? [];
  if (existing.length > 1) return {error: `"${path.join('.')}" appears ${existing.length} times; resolve the duplicates first`};
  const unit = indentUnit(text);
  if (existing.length === 1) {
    const member = existing[0]!;
    let current: unknown;
    try { current = parseJsonc(text.slice(member.valueStart, member.valueEnd)); } catch { current = undefined; }
    if (deepEqual(current, value)) return {text, changed: 'none'};
    const replacement = reindent(JSON.stringify(value, null, unit), lineIndentAt(text, member.keyStart));
    return {text: text.slice(0, member.valueStart) + replacement + text.slice(member.valueEnd), changed: 'update'};
  }
  // Deepest existing ancestor that is an object; a non-object ancestor value is a conflict.
  let depth = path.length - 1;
  while (depth > 0 && !scan.objects.has(keyOf(path.slice(0, depth)))) {
    if (scan.members.has(keyOf(path.slice(0, depth)))) return {error: `"${path.slice(0, depth).join('.')}" exists but is not an object`};
    depth -= 1;
  }
  const parent = scan.objects.get(keyOf(path.slice(0, depth)))!;
  let nested: unknown = value;
  for (let index = path.length - 1; index > depth; index -= 1) nested = {[path[index]!]: nested};
  const parentIndent = lineIndentAt(text, parent.open);
  const memberIndent = parentIndent + unit;
  const member = `"${path[depth]}": ${reindent(JSON.stringify(nested, null, unit), memberIndent)}`;
  if (!parent.members) {
    return {text: `${text.slice(0, parent.open + 1)}\n${memberIndent}${member}\n${parentIndent}${text.slice(parent.close)}`, changed: 'add'};
  }
  const between = text.slice(parent.lastValueEnd!, parent.close);
  const trailingComma = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*,/u.test(between);
  // After an existing trailing comma (JSONC), the new member goes after it and keeps the file's trailing-comma style.
  const insertAt = trailingComma ? parent.lastValueEnd! + between.indexOf(',') + 1 : parent.lastValueEnd!;
  return {text: `${text.slice(0, insertAt)}${trailingComma ? '' : ','}\n${memberIndent}${member}${trailingComma ? ',' : ''}${text.slice(insertAt)}`, changed: 'add'};
}

/* ---------- key = value (Ghostty, .npmrc) and TOML tables ---------- */

function setKeyValueOnce(text: string, key: string, value: string, format: ConfigFormat, table?: string): {text: string; changed: 'add' | 'update' | 'none'} | {error: string} {
  const lines = text.split('\n');
  const header = (line: string) => /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/u.exec(line)?.[1];
  let start = 0;
  let end = lines.length;
  if (format === 'toml') {
    if (table) {
      start = lines.findIndex(line => header(line) === table);
      if (start === -1) {
        const block = `${text.endsWith('\n') || !text ? '' : '\n'}\n[${table}]\n${key} = ${value}\n`;
        return {text: text + block, changed: 'add'};
      }
      start += 1;
    }
    const next = lines.findIndex((line, index) => index >= start && header(line) !== undefined);
    end = next === -1 ? lines.length : next;
  }
  const pattern = new RegExp(`^(\\s*${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*=\\s*)(.*?)(\\s*(?:#.*)?)$`, 'u');
  const hits = lines.map((line, index) => ({line, index})).filter(item => item.index >= start && item.index < end && pattern.test(item.line));
  // Ghostty allows repeatable keys; a second copy is ambiguous for "set".
  if (hits.length > 1) return {error: `${key} is set ${hits.length} times; resolve that first`};
  if (hits.length === 1) {
    const match = pattern.exec(hits[0]!.line)!;
    if (match[2]!.trim() === value) return {text, changed: 'none'};
    lines[hits[0]!.index] = `${match[1]}${value}${match[3]}`;
    return {text: lines.join('\n'), changed: 'update'};
  }
  let insertAt = end;
  while (insertAt > start && lines[insertAt - 1]!.trim() === '') insertAt -= 1;
  lines.splice(insertAt, 0, `${key} = ${value}`);
  return {text: lines.join('\n'), changed: 'add'};
}

export function tomlValue(raw: string): string {
  const value = raw.trim();
  if (/^(?:true|false|-?\d+(?:\.\d+)?|".*"|'.*'|\[.*\]|\{.*\})$/u.test(value)) return value;
  return JSON.stringify(value);
}

/* ---------- plans ---------- */

/** One minimal edit from old → new text: the changed region only. */
function minimalEdit(before: string, after: string): FileEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore -= 1; endAfter -= 1; }
  return {start, end: endBefore, text: after.slice(start, endAfter)};
}

const mask = (line: string) => SECRET.test(line) ? line.replace(/([=:]\s*).*/u, '$1••••') : line;

/** A bounded diff around the change: one context line each side, unrelated secret-looking values masked. */
export function previewDiff(before: string, after: string, edit: FileEdit, limit = 24): {lines: string[]; line: number} {
  const startLine = before.slice(0, edit.start).split('\n').length - 1;
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const oldEnd = before.slice(0, edit.end).split('\n').length;
  const newEnd = after.slice(0, edit.start + edit.text.length).split('\n').length;
  const out: string[] = [];
  if (startLine > 0) out.push(`  ${mask(oldLines[startLine - 1]!)}`);
  for (const line of oldLines.slice(startLine, oldEnd)) out.push(`- ${line}`);
  for (const line of newLines.slice(startLine, newEnd)) out.push(`+ ${line}`);
  if (oldEnd < oldLines.length) out.push(`  ${mask(oldLines[oldEnd]!)}`);
  // Values that look secret are masked everywhere except the lines the person is adding.
  for (let index = 0; index < out.length; index += 1) if (!out[index]!.startsWith('+ ')) out[index] = `${out[index]!.slice(0, 2)}${mask(out[index]!.slice(2))}`;
  const bounded = out.length > limit ? [...out.slice(0, limit), `  … ${out.length - limit} more lines`] : out;
  return {lines: bounded, line: startLine + 1};
}

function plan(facts: FileFacts, format: FileEditPlan['format'], operation: FileEditPlan['operation'], after: string, reason: string): PlanResult {
  const before = facts.content!;
  if (after === before) return {kind: 'noop', reason};
  const edit = minimalEdit(before, after);
  const diff = previewDiff(before, after, edit);
  return {kind: 'plan', plan: {path: facts.path, resolvedPath: facts.resolvedPath, symlink: facts.symlink, format, operation, edits: [edit],
    expectedSha256: sha256(before), resultSha256: sha256(after), preview: diff.lines, line: diff.line, reason}};
}

const unusable = (facts: FileFacts): PlanResult | undefined => facts.content === undefined || facts.refusal ? {kind: 'refuse', reason: `${facts.path} ${facts.refusal ?? 'cannot be read'}.`} : undefined;

/** Merge a JSON/JSONC snippet (or one key path) into a file: add, update or no-op per leaf; duplicates refuse. */
export function planJsonSet(facts: FileFacts, format: 'json' | 'jsonc', assignments: Array<{path: string[]; value: unknown}>, prefix: string[] = []): PlanResult {
  const blocked = unusable(facts);
  if (blocked) return blocked;
  let text = facts.content!;
  const changes: string[] = [];
  for (const assignment of assignments) {
    const path = [...prefix, ...assignment.path];
    const result = setJsonOnce(text, path, assignment.value, format === 'jsonc');
    if ('error' in result) return {kind: 'refuse', reason: `${facts.path}: ${result.error}.`};
    if (result.changed !== 'none') changes.push(`${result.changed === 'add' ? 'adds' : 'updates'} ${path.join('.')}`);
    text = result.text;
  }
  if (!changes.length) return {kind: 'noop', reason: `${facts.path} already has ${assignments.length === 1 ? 'that setting' : 'those settings'}; nothing to change.`};
  return plan(facts, format, changes.every(change => change.startsWith('adds')) ? 'add' : 'update', text, changes.join(', '));
}

export function planKeyValueSet(facts: FileFacts, format: ConfigFormat, key: string, value: string, table?: string): PlanResult {
  const blocked = unusable(facts);
  if (blocked) return blocked;
  const result = setKeyValueOnce(facts.content!, key, format === 'toml' ? tomlValue(value) : value.trim(), format, table);
  if ('error' in result) return {kind: 'refuse', reason: `${facts.path}: ${result.error}.`};
  if (result.changed === 'none') return {kind: 'noop', reason: `${facts.path} already sets ${key} = ${value.trim()}; nothing to change.`};
  return plan(facts, format, result.changed === 'add' ? 'add' : 'update', result.text, `${result.changed === 'add' ? 'adds' : 'updates'} ${table ? `${table}.` : ''}${key}`);
}

/** Append a line or block (shell rc, plain text) unless it is already there exactly. */
export function planAppend(facts: FileFacts, format: ConfigFormat, block: string): PlanResult {
  const blocked = unusable(facts);
  if (blocked) return blocked;
  const content = facts.content!;
  const wanted = block.replace(/\s+$/u, '');
  if (!wanted) return {kind: 'refuse', reason: 'There is nothing to add.'};
  const lines = content.split('\n').map(line => line.trimEnd());
  const blockLines = wanted.split('\n').map(line => line.trimEnd());
  const present = lines.some((_, index) => blockLines.every((line, offset) => lines[index + offset] === line));
  if (present) return {kind: 'noop', reason: `${facts.path} already contains that; nothing to add.`};
  const separator = content === '' || content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  return plan(facts, format, 'append', `${content}${separator}${wanted}\n`, `appends ${blockLines.length} line${blockLines.length === 1 ? '' : 's'} at the end`);
}

const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

/** Replace exact text: one occurrence becomes a plan; none or several are reported, never guessed. */
export function planReplace(facts: FileFacts, oldText: string, newText: string, occurrence?: number): PlanResult {
  const blocked = unusable(facts);
  if (blocked) return blocked;
  const content = facts.content!;
  if (!oldText) return {kind: 'refuse', reason: 'Say exactly what text to replace.'};
  const starts: number[] = [];
  for (let at = content.indexOf(oldText); at !== -1; at = content.indexOf(oldText, at + 1)) starts.push(at);
  if (!starts.length) return {kind: 'refuse', reason: `That exact text is not in ${facts.path}${/\n/u.test(oldText) ? ' (whitespace and indentation must match)' : ''}.`};
  if (starts.length > 1 && occurrence === undefined) {
    return {kind: 'matches', reason: `I found ${starts.length} matches in ${facts.path}.`, matches: starts.map(start => ({line: lineOf(content, start), start, end: start + oldText.length,
      preview: content.slice(content.lastIndexOf('\n', start - 1) + 1, content.indexOf('\n', start) === -1 ? undefined : content.indexOf('\n', start)).trim().slice(0, 80)}))};
  }
  const start = occurrence !== undefined ? starts.find(item => item === occurrence) : starts[0];
  if (start === undefined) return {kind: 'refuse', reason: `${facts.path} changed; that match is no longer there.`};
  const after = content.slice(0, start) + newText + content.slice(start + oldText.length);
  return plan(facts, 'source', 'replace', after, `replaces ${starts.length > 1 ? `the match at line ${lineOf(content, start)}` : 'the only match'}`);
}

/** Create a missing file with known-valid initial content (only for targets that declare it); refuses if it now exists. */
export function planCreate(path: string, content: string, allowedRoots: readonly string[]): PlanResult {
  if (!allowedRoots.some(root => path.startsWith(`${root}/`))) return {kind: 'refuse', reason: `${path} is outside your home folder; Ask won't create it.`};
  const lines = content.replace(/\n$/u, '').split('\n').map(line => `+ ${line}`);
  return {kind: 'plan', plan: {path, resolvedPath: path, symlink: false, format: 'json', operation: 'create', edits: [{start: 0, end: 0, text: content}],
    expectedSha256: ABSENT, resultSha256: sha256(content), preview: lines, line: 1, reason: 'creates the file'}};
}

/** The precondition for a create: the file must still not exist. */
export const ABSENT = 'absent';

/* ---------- applying and rendering ---------- */

/** NMSh's own Run: the same plan, applied without a shell. Refuses if the file changed; atomic rename; mode kept. */
export function applyPlan(plan: FileEditPlan): {ok: true} | {ok: false; reason: string} {
  if (plan.expectedSha256 === ABSENT) {
    try {
      mkdirSync(dirname(plan.resolvedPath), {recursive: true});
      writeFileSync(plan.resolvedPath, plan.edits[0]!.text, {encoding: 'utf8', flag: 'wx', mode: 0o644});
      return {ok: true};
    } catch (error) {
      return {ok: false, reason: (error as NodeJS.ErrnoException).code === 'EEXIST' ? `${plan.path} now exists, so nothing was written. Ask again to inspect it.` : `Creating ${plan.path} failed; nothing was written.`};
    }
  }
  let current: string;
  try { current = readFileSync(plan.resolvedPath, 'utf8'); } catch { return {ok: false, reason: `${plan.path} can no longer be read.`}; }
  if (sha256(current) !== plan.expectedSha256) return {ok: false, reason: `${plan.path} changed since Ask read it, so nothing was written. Ask again to re-inspect it.`};
  let next = current;
  for (const edit of [...plan.edits].sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  if (sha256(next) !== plan.resultSha256) return {ok: false, reason: 'The edit did not produce the previewed result, so nothing was written.'};
  const temporary = join(dirname(plan.resolvedPath), `.nmsh-edit-${process.pid}-${Date.now()}`);
  try {
    const mode = statSync(plan.resolvedPath).mode & 0o7777;
    writeFileSync(temporary, next, {encoding: 'utf8', mode});
    chmodSync(temporary, mode);
    renameSync(temporary, plan.resolvedPath);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* nothing left behind */ }
    return {ok: false, reason: `Writing ${plan.path} failed: ${error instanceof Error ? error.message : String(error)}. The file was not changed.`};
  }
  return {ok: true};
}

/** UTF-16 offsets to code points, for the Python backend. */
const codePoints = (text: string, offset: number) => [...text.slice(0, offset)].length;

/**
 * The command a person can copy or insert: a small script that checks the
 * sha256 precondition, applies exactly the planned edits, keeps the mode and
 * renames atomically; it exits non-zero without writing if the file changed.
 * Single-quoted and free of quotes and backslashes inside, so it works the
 * same in zsh, Bash and Fish. Python 3 when present, else NMSh's own Node.
 */
export function renderEditCommand(plan: FileEditPlan, content: string, runtimes: {python3?: string; node: string}): string {
  if (runtimes.python3) {
    const payload = Buffer.from(JSON.stringify({path: plan.resolvedPath, sha256: plan.expectedSha256,
      edits: plan.edits.map(edit => ({start: codePoints(content, edit.start), end: codePoints(content, edit.end), text: edit.text}))})).toString('base64');
    return [`python3 -c '`,
      'import base64, hashlib, json, os, sys, tempfile',
      `p = json.loads(base64.b64decode("${payload}"))`,
      'path = p["path"]',
      'if p["sha256"] == "absent" and os.path.exists(path): sys.exit("nmsh: " + path + " now exists; nothing was written")',
      'if p["sha256"] == "absent": os.makedirs(os.path.dirname(path), exist_ok=True); open(path, "x", encoding="utf-8").write(p["edits"][0]["text"]); print("nmsh: created " + path); sys.exit(0)',
      'data = open(path, "rb").read()',
      'if hashlib.sha256(data).hexdigest() != p["sha256"]: sys.exit("nmsh: " + path + " changed since it was inspected; nothing was written")',
      'text = data.decode("utf-8")',
      'for e in sorted(p["edits"], key=lambda e: e["start"], reverse=True): text = text[:e["start"]] + e["text"] + text[e["end"]:]',
      'mode = os.stat(path).st_mode & 0o7777',
      'fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".nmsh-edit-")',
      'f = os.fdopen(fd, "w", encoding="utf-8", newline=""); f.write(text); f.close()',
      'os.chmod(tmp, mode); os.replace(tmp, path); print("nmsh: updated " + path)',
      `'`].join('\n');
  }
  const payload = Buffer.from(JSON.stringify({path: plan.resolvedPath, sha256: plan.expectedSha256, edits: plan.edits})).toString('base64');
  return [`${/^[\w@%+=:,./-]+$/u.test(runtimes.node) ? runtimes.node : `"${runtimes.node.replace(/["$`]/gu, '')}"`} -e '`,
    'const fs = require("fs"), path = require("path"), crypto = require("crypto");',
    `const p = JSON.parse(Buffer.from("${payload}", "base64").toString());`,
    'if (p.sha256 === "absent") { fs.mkdirSync(path.dirname(p.path), {recursive: true}); fs.writeFileSync(p.path, p.edits[0].text, {flag: "wx"}); console.log("nmsh: created " + p.path); process.exit(0); }',
    'const data = fs.readFileSync(p.path, "utf8");',
    'if (crypto.createHash("sha256").update(data, "utf8").digest("hex") !== p.sha256) { console.error("nmsh: " + p.path + " changed since it was inspected; nothing was written"); process.exit(1); }',
    'let text = data; for (const e of [...p.edits].sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);',
    'const mode = fs.statSync(p.path).mode & 0o7777, tmp = path.join(path.dirname(p.path), ".nmsh-edit-" + process.pid);',
    'fs.writeFileSync(tmp, text, {mode}); fs.chmodSync(tmp, mode); fs.renameSync(tmp, p.path); console.log("nmsh: updated " + p.path);',
    `'`].join('\n');
}
