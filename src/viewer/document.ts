import {constants} from 'node:fs';
import {lstat, open, realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, extname, isAbsolute, join, resolve} from 'node:path';
import {languageId} from '../markdown/highlight.js';

/**
 * A document for the native viewer (#397) and editor: lines of text and where they came from. Loading is read-only and
 * bounded: only regular files are read (a FIFO or device is refused before anything waits on it), at most
 * MAX_VIEW_BYTES and MAX_VIEW_LINES are kept, binary content is refused, and invalid UTF-8 is shown with replacement
 * characters and a note. Nothing is executed, followed beyond the file's own symlink, fetched or written.
 */

export const MAX_VIEW_BYTES = 8 * 1024 * 1024;
export const MAX_VIEW_LINES = 200_000;
/** Bytes inspected for binary content. */
const SNIFF_BYTES = 8192;
const CHUNK = 64 * 1024;

export type DocumentFormat = 'text' | 'markdown' | 'diff';

export type DocumentOrigin =
  | {kind: 'file'; path: string; realPath: string; symlink: boolean; bytes: number; mtimeMs: number}
  | {kind: 'output'; command: string; number: number; exitCode?: number};

export interface ViewDocument {
  /** What the header names: the path as given (home shortened) or the command. */
  title: string;
  origin: DocumentOrigin;
  lines: string[];
  /** The text copying the whole document gives: the decoded file up to the limits, or the record's output. */
  text: string;
  format: DocumentFormat;
  /** A grammar id for syntax roles, when the file type is known. */
  language?: string;
  /** Limits that applied, said plainly (truncation, encoding). */
  notes: string[];
  lineEnding: 'lf' | 'crlf' | 'mixed' | 'none';
  /** False when the text was cut at a read or line limit. */
  complete: boolean;
}

export type LoadResult = {ok: true; document: ViewDocument} | {ok: false; reason: string};

/** `~` and `~/…` name the home directory; other relative paths are relative to the shell's directory. */
export function resolveViewPath(input: string, cwd: string, home = homedir()): string {
  const trimmed = input.trim();
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/')) return join(home, trimmed.slice(2));
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}

/** Text from a file name or path made inert for display: controls and invisible format characters become marks. */
export function inert(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu, character => character === '\u001b' ? '␛' : '·');
}

/** The path as people read it (under home it starts with ~), safe to draw: a file name can hold control characters. */
export function displayPath(path: string, home = homedir()): string {
  return inert(home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path);
}

const FILE_NAMES: Record<string, string> = {makefile: 'makefile', gnumakefile: 'makefile', dockerfile: 'dockerfile', containerfile: 'dockerfile',
  '.bashrc': 'shell', '.zshrc': 'shell', '.zshenv': 'shell', '.profile': 'shell', '.bash_profile': 'shell', 'config.fish': 'fish', justfile: 'makefile'};

/** How a file reads: Markdown and diffs by their extension, syntax roles by extension or well-known name. */
export function formatForPath(path: string): {format: DocumentFormat; language?: string} {
  const name = basename(path).toLowerCase();
  const extension = extname(name).slice(1);
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx') return {format: 'markdown', language: 'markdown'};
  if (extension === 'diff' || extension === 'patch') return {format: 'diff', language: 'diff'};
  const language = languageId(FILE_NAMES[name] ?? extension);
  return {format: 'text', ...(language ? {language} : {})};
}

/** Commands whose output is a unified diff; anything else is plain text (output is never implicitly Markdown). */
const DIFF_COMMAND = /^\s*(?:git\s+(?:--no-pager\s+)?(?:diff|show|log\s+(?:.*\s)?-p)\b|diff\s+(?:-\S*u|--unified)|hg\s+diff\b|jj\s+diff\b)/u;

/** A completed command's stored output as a document (the same text `/copy` copies). */
export function outputDocument(record: {command: string; output: string; exitCode?: number}, number: number): ViewDocument {
  const {lines, lineEnding} = splitLines(record.output);
  const diff = DIFF_COMMAND.test(record.command) && lines.some(line => line.startsWith('@@'));
  return {title: record.command, origin: {kind: 'output', command: record.command, number, ...(record.exitCode !== undefined ? {exitCode: record.exitCode} : {})},
    lines, text: record.output, format: diff ? 'diff' : 'text', ...(diff ? {language: 'diff'} : {}), notes: [], lineEnding, complete: true};
}

function splitLines(text: string): {lines: string[]; lineEnding: ViewDocument['lineEnding']} {
  if (!text) return {lines: [], lineEnding: 'none'};
  const raw = text.split('\n');
  if (raw.at(-1) === '') raw.pop();
  let crlf = 0;
  const terminated = text.endsWith('\n') ? raw.length : raw.length - 1;
  const lines = raw.map((line, index) => {
    if (line.endsWith('\r')) { if (index < terminated) crlf += 1; return line.slice(0, -1); }
    return line;
  });
  const lineEnding = terminated === 0 ? 'none' : crlf === 0 ? 'lf' : crlf === terminated ? 'crlf' : 'mixed';
  return {lines, lineEnding};
}

function describe(error: unknown, shown: string): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return `${shown} does not exist.`;
  if (code === 'EACCES' || code === 'EPERM') return `${shown} cannot be read: permission denied.`;
  if (code === 'ELOOP') return `${shown} is a symlink loop.`;
  if (code === 'ENOTDIR') return `${shown}: a part of the path is not a directory.`;
  if (code === 'EISDIR') return `${shown} is a directory.`;
  if (code === 'ABORT_ERR') return 'Cancelled.';
  return `${shown} cannot be read${code ? ` (${code})` : ''}.`;
}

/** Read a regular file for viewing (see the module comment for the limits). */
export async function loadFileDocument(input: string, cwd: string, options: {home?: string; maxBytes?: number; maxLines?: number; signal?: AbortSignal} = {}): Promise<LoadResult> {
  const home = options.home ?? homedir();
  const path = resolveViewPath(input, cwd, home);
  const shown = displayPath(path, home);
  const maxBytes = options.maxBytes ?? MAX_VIEW_BYTES;
  let symlink = false;
  try { symlink = (await lstat(path)).isSymbolicLink(); } catch (error) { return {ok: false, reason: describe(error, shown)}; }
  let handle;
  // Non-blocking: opening a FIFO never waits for a writer, and is refused below like any other non-regular file.
  try { handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOCTTY ?? 0)); }
  catch (error) { return {ok: false, reason: describe(error, shown)}; }
  try {
    const info = await handle.stat();
    if (info.isDirectory()) return {ok: false, reason: `${shown} is a directory.`};
    if (!info.isFile()) return {ok: false, reason: `${shown} is not a regular file; /view reads files only.`};
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      if (options.signal?.aborted) return {ok: false, reason: 'Cancelled.'};
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK, maxBytes + 1 - total));
      const {bytesRead} = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    let bytes = Buffer.concat(chunks, total);
    const notes: string[] = [];
    let complete = true;
    if (bytes.length > maxBytes) {
      complete = false;
      let cut = maxBytes;
      // Never split a UTF-8 sequence: step back over continuation bytes.
      while (cut > 0 && (bytes[cut]! & 0xc0) === 0x80) cut -= 1;
      bytes = bytes.subarray(0, cut);
      notes.push(`Showing the first ${formatBytes(cut)} of ${formatBytes(info.size)}; open it with less or an editor for the rest.`);
    }
    const sniff = bytes.subarray(0, SNIFF_BYTES);
    if ((sniff[0] === 0xff && sniff[1] === 0xfe) || (sniff[0] === 0xfe && sniff[1] === 0xff)) {
      return {ok: false, reason: `${shown} is UTF-16 text, which /view does not decode; try less or an editor.`};
    }
    if (sniff.includes(0)) return {ok: false, reason: `${shown} looks binary (it contains NUL bytes); /view shows text only.`};
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
    let text: string;
    try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
    catch {
      text = new TextDecoder('utf-8').decode(bytes);
      notes.push('Not valid UTF-8: undecodable bytes are shown as �.');
    }
    let {lines, lineEnding} = splitLines(text);
    const maxLines = options.maxLines ?? MAX_VIEW_LINES;
    if (lines.length > maxLines) {
      complete = false;
      notes.push(`Showing the first ${maxLines.toLocaleString('en-US')} lines; open it with less or an editor for the rest.`);
      lines = lines.slice(0, maxLines);
      text = lines.join(lineEnding === 'crlf' ? '\r\n' : '\n');
    }
    let realPath = path;
    if (symlink) { try { realPath = await realpath(path); } catch { /* the link changed meanwhile; the descriptor read is what is shown */ } }
    const {format, language} = formatForPath(path);
    return {ok: true, document: {title: shown, origin: {kind: 'file', path, realPath, symlink, bytes: info.size, mtimeMs: info.mtimeMs}, lines, text, format,
      ...(language ? {language} : {}), notes, lineEnding, complete}};
  } catch (error) {
    return {ok: false, reason: describe(error, shown)};
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
