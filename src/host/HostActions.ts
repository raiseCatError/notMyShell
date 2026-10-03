import {spawn} from 'node:child_process';
import {accessSync, constants, statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {basename, delimiter, isAbsolute, join, resolve} from 'node:path';
import {homedir} from 'node:os';

/**
 * HostActions: delegate editor-native work to the editor around NMSh.
 *
 * NMSh owns terminal-native interaction (composer, transcript, find/filter,
 * sessions). Opening a file at a location, opening a folder, or showing a
 * rich diff belong to an editor, so NMSh hands them over:
 *
 *   Zed      `zed <path>:<line>[:<column>]`, `zed <dir>`, `zed --diff <old> <new>` (when its --help lists --diff)
 *   VS Code  `code --goto <path>:<line>[:<column>]`, `code <dir>`, `code --diff <old> <new>`
 *   Editor   $VISUAL / $EDITOR (or the configured editor): a visible command
 *            placed in the composer for you to run; never executed silently
 *
 * Capabilities, not brands, are the contract. A terminal emulator is never
 * treated as an editor (Ghostty, Terminal.app and others have no adapter).
 * Every launch is argv-based: paths are single argv elements, never shell text.
 */

export type OpenWith = 'auto' | 'zed' | 'vscode' | 'editor';
export const OPEN_WITH_IDS: readonly OpenWith[] = ['auto', 'zed', 'vscode', 'editor'];

export interface SourceLocation {
  path: string;
  line?: number;
  column?: number;
}

export interface HostCapabilities {
  /** The editor whose integrated terminal NMSh runs in, when it is known. */
  integratedEditor?: 'zed' | 'vscode';
  nativeFileOpen: boolean;
  nativeDirectoryOpen: boolean;
  nativeDiff: boolean;
}

export type HostAction =
  /** Launch a GUI editor process (argv; detached). */
  | {kind: 'spawn'; command: string; args: string[]; label: string}
  /** Put a reviewed command in the composer for a terminal editor. */
  | {kind: 'compose'; argv: string[]; label: string}
  | {kind: 'unsupported'; reason: string};

export interface HostActionAdapter {
  readonly id: 'zed' | 'vscode' | 'editor' | 'none';
  readonly label: string;
  readonly capabilities: HostCapabilities;
  openFile(location: SourceLocation): HostAction;
  openDirectory(path: string): HostAction;
  openDiff(left: string, right: string): HostAction;
}

export interface HostEnvironment {
  env: NodeJS.ProcessEnv;
  /** Absolute executable for a name on PATH, if any. */
  which(name: string): string | undefined;
  /** First lines of `<cli> --help`, to check for documented flags before using them. */
  helpText(executable: string): string;
}

export function systemHostEnvironment(env: NodeJS.ProcessEnv = process.env): HostEnvironment {
  const help = new Map<string, string>();
  return {
    env,
    which: name => {
      for (const directory of (env.PATH ?? '').split(delimiter)) {
        if (!isAbsolute(directory)) continue;
        const candidate = join(directory, name);
        try { if (statSync(candidate).isFile()) { accessSync(candidate, constants.X_OK); return candidate; } } catch { /* next */ }
      }
      return undefined;
    },
    helpText: executable => {
      if (!help.has(executable)) {
        try {
          const result = spawnSync(executable, ['--help'], {encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe']});
          help.set(executable, `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(0, 64 * 1024));
        } catch { help.set(executable, ''); }
      }
      return help.get(executable)!;
    },
  };
}

const location = (target: SourceLocation) => `${target.path}${target.line ? `:${target.line}${target.column ? `:${target.column}` : ''}` : ''}`;

function zedAdapter(executable: string, host: HostEnvironment, integrated: boolean): HostActionAdapter {
  const diff = /--diff\b/u.test(host.helpText(executable));
  return {
    id: 'zed', label: 'Zed',
    capabilities: {...(integrated ? {integratedEditor: 'zed' as const} : {}), nativeFileOpen: true, nativeDirectoryOpen: true, nativeDiff: diff},
    openFile: target => ({kind: 'spawn', command: executable, args: [location(target)], label: `zed ${location(target)}`}),
    openDirectory: path => ({kind: 'spawn', command: executable, args: [path], label: `zed ${path}`}),
    openDiff: (left, right) => diff
      ? {kind: 'spawn', command: executable, args: ['--diff', left, right], label: `zed --diff ${left} ${right}`}
      : {kind: 'unsupported', reason: 'This Zed CLI does not list --diff in `zed --help`; update Zed for diff support, or run git diff here.'},
  };
}

function vscodeAdapter(executable: string, integrated: boolean): HostActionAdapter {
  return {
    id: 'vscode', label: 'VS Code',
    capabilities: {...(integrated ? {integratedEditor: 'vscode' as const} : {}), nativeFileOpen: true, nativeDirectoryOpen: true, nativeDiff: true},
    // --goto takes path:line[:character]; without a line the plain path is opened.
    openFile: target => (target.line
      ? {kind: 'spawn', command: executable, args: ['--goto', location(target)], label: `code --goto ${location(target)}`}
      : {kind: 'spawn', command: executable, args: [target.path], label: `code ${target.path}`}),
    openDirectory: path => ({kind: 'spawn', command: executable, args: [path], label: `code ${path}`}),
    openDiff: (left, right) => ({kind: 'spawn', command: executable, args: ['--diff', left, right], label: `code --diff ${left} ${right}`}),
  };
}

/** How common terminal editors take a line (and column): only forms their documentation describes. */
export function editorArguments(editor: readonly string[], target: SourceLocation): string[] {
  const name = basename(editor[0] ?? '');
  if (!target.line) return [...editor, target.path];
  if (['hx', 'helix'].includes(name)) return [...editor, location(target)];
  if (name === 'micro') return [...editor, `+${target.line}${target.column ? `:${target.column}` : ''}`, target.path];
  if (['vi', 'vim', 'nvim', 'view', 'nano', 'emacs', 'emacsclient', 'kak', 'pico', 'mg', 'joe'].includes(name)) return [...editor, `+${target.line}`, target.path];
  // Unknown editor: no guessed location flag; the file opens at its start.
  return [...editor, target.path];
}

function editorAdapter(editor: string[]): HostActionAdapter {
  const label = editor[0] ?? 'editor';
  return {
    id: 'editor', label: basename(label),
    capabilities: {nativeFileOpen: true, nativeDirectoryOpen: false, nativeDiff: false},
    openFile: target => ({kind: 'compose', argv: editorArguments(editor, target), label: basename(label)}),
    openDirectory: () => ({kind: 'unsupported', reason: `${basename(label)} is a terminal editor; NMSh does not open folders in it. Use cd here, or an editor with a folder view.`}),
    openDiff: () => ({kind: 'unsupported', reason: 'No editor with a native diff view is configured. Run git diff (or diff -u) here, or set Open with to Zed or VS Code.'}),
  };
}

const NONE: HostActionAdapter = {
  id: 'none', label: 'none',
  capabilities: {nativeFileOpen: false, nativeDirectoryOpen: false, nativeDiff: false},
  openFile: () => ({kind: 'unsupported', reason: 'No editor is known here: not inside Zed or VS Code, and neither VISUAL nor EDITOR is set. Set one, or choose Open with in /settings.'}),
  openDirectory: () => ({kind: 'unsupported', reason: 'No editor with a folder view is known here.'}),
  openDiff: () => ({kind: 'unsupported', reason: 'No editor with a native diff view is known here. git diff works in the transcript as usual.'}),
};

/** VISUAL then EDITOR, split on whitespace (no shell parsing; quotes are not interpreted). */
export function configuredEditor(env: NodeJS.ProcessEnv): string[] | undefined {
  const value = (env.VISUAL || env.EDITOR || '').trim();
  return value ? value.split(/\s+/u) : undefined;
}

/**
 * Pick the adapter: an explicit choice wins; otherwise the editor NMSh runs
 * inside (from its own terminal environment), then VISUAL/EDITOR.
 */
export function resolveHostActions(openWith: OpenWith, host: HostEnvironment = systemHostEnvironment()): HostActionAdapter {
  const program = host.env.TERM_PROGRAM;
  const inZed = program === 'zed' || Boolean(host.env.ZED_TERM);
  const inVsCode = program === 'vscode';
  const zed = () => host.which('zed') ?? host.which('zeditor');
  const code = () => host.which('code');
  if (openWith === 'zed' || (openWith === 'auto' && inZed)) {
    const executable = zed();
    if (executable) return zedAdapter(executable, host, inZed);
    if (openWith === 'zed') return {...NONE, openFile: () => ({kind: 'unsupported', reason: 'Open with is Zed, but the zed CLI is not on PATH (Zed: "cli: install").'})};
  }
  if (openWith === 'vscode' || (openWith === 'auto' && inVsCode)) {
    const executable = code();
    if (executable) return vscodeAdapter(executable, inVsCode);
    if (openWith === 'vscode') return {...NONE, openFile: () => ({kind: 'unsupported', reason: 'Open with is VS Code, but the code CLI is not on PATH (VS Code: "Shell Command: Install \'code\' command in PATH").'})};
  }
  const editor = configuredEditor(host.env);
  if (editor) {
    // A GUI editor named in EDITOR keeps its native integration.
    const name = basename(editor[0]!);
    if ((name === 'code' || name === 'zed') && editor.length <= 2 && !editor.slice(1).some(arg => arg !== '-w' && arg !== '--wait')) {
      const executable = host.which(name) ?? (isAbsolute(editor[0]!) ? editor[0] : undefined);
      if (executable) return name === 'code' ? vscodeAdapter(executable, inVsCode) : zedAdapter(executable, host, inZed);
    }
    return editorAdapter(editor);
  }
  return NONE;
}

/** Launch a GUI editor detached, argv only. Resolves with a failure reason, never throws. */
export function runHostAction(action: Extract<HostAction, {kind: 'spawn'}>): Promise<string | undefined> {
  return new Promise(resolve => {
    try {
      const child = spawn(action.command, action.args, {detached: true, stdio: 'ignore', shell: false});
      child.once('error', error => resolve(error.message));
      child.once('spawn', () => { child.unref(); resolve(undefined); });
    } catch (error) { resolve(error instanceof Error ? error.message : String(error)); }
  });
}

// ------------------------------------------------------------ source references

/**
 * `path:line[:column]` references as compilers, test runners and linters
 * print them. Paths may be relative, absolute or ~-prefixed; quoted forms may
 * contain spaces. Bare words without a line are not references.
 */
const QUOTED = /(["'`])((?:\/|~\/|\.{1,2}\/|[\w@.+-])[^"'`\n]*?):(\d{1,7})(?::(\d{1,5}))?\1/gu;
const BARE = /(?:^|[\s(\[<])((?:\/|~\/|\.{1,2}\/)?[\w@.+-][\w@.+\-/]*\.[\w]+|(?:\/|~\/|\.{1,2}\/)[\w@.+\-/]+):(\d{1,7})(?::(\d{1,5}))?(?=$|[\s:,;)\]>])/gu;

export interface SourceReference extends SourceLocation {
  /** The reference exactly as printed. */
  text: string;
}

export function findSourceReferences(line: string): SourceReference[] {
  const references: SourceReference[] = [];
  const seen = new Set<string>();
  const add = (path: string, lineText: string, columnText: string | undefined, text: string) => {
    const key = `${path}:${lineText}:${columnText ?? ''}`;
    if (seen.has(key) || /^https?$/iu.test(path) || /^\d+$/u.test(path)) return;
    seen.add(key);
    references.push({path, line: Number(lineText), ...(columnText ? {column: Number(columnText)} : {}), text});
  };
  const quoted: Array<[number, number]> = [];
  for (const match of line.matchAll(QUOTED)) {
    quoted.push([match.index, match.index + match[0].length]);
    add(match[2]!, match[3]!, match[4], match[0]);
  }
  for (const match of line.matchAll(BARE)) {
    // Part of a quoted reference already taken whole (a path with spaces).
    if (quoted.some(([start, end]) => match.index < end && match.index + match[0].length > start)) continue;
    add(match[1]!, match[2]!, match[3], match[0].trimStart().replace(/^[(\[<]/u, ''));
  }
  return references;
}

/** `/open` argument: the whole text is the path (spaces allowed); a trailing :line[:column] is the location. */
export function parseOpenArgument(text: string): SourceLocation | undefined {
  const trimmed = text.trim().replace(/^(["'])(.*)\1$/u, '$2');
  if (!trimmed) return undefined;
  const match = /^(.*?):(\d{1,7})(?::(\d{1,5}))?$/u.exec(trimmed);
  if (match && match[1]) return {path: match[1], line: Number(match[2]), ...(match[3] ? {column: Number(match[3])} : {})};
  return {path: trimmed};
}

export type ResolvedLocation = {ok: true; location: SourceLocation; kind: 'file' | 'directory'} | {ok: false; reason: string};

/** Resolve against the command's own cwd (not NMSh's), expand ~, and require the target to exist. */
export function resolveLocation(target: SourceLocation, cwd: string, home = homedir()): ResolvedLocation {
  if (/[\u0000-\u001f\u007f]/u.test(target.path)) return {ok: false, reason: 'The path contains control characters.'};
  const expanded = target.path === '~' ? home : target.path.startsWith('~/') ? join(home, target.path.slice(2)) : target.path;
  const path = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  let stat;
  try { stat = statSync(path); } catch { return {ok: false, reason: `${path} does not exist.`}; }
  if (stat.isDirectory()) return {ok: true, kind: 'directory', location: {path}};
  if (!stat.isFile()) return {ok: false, reason: `${path} is not a regular file.`};
  return {ok: true, kind: 'file', location: {...target, path}};
}
