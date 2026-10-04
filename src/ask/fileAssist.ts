import {closeSync, openSync, readSync, statSync} from 'node:fs';
import {basename, extname, isAbsolute, join, relative, resolve} from 'node:path';
import {listDirectory, matchFiles, NOISY_DIRECTORIES} from './files.js';
import type {AskContext, AskOption, AskOutcome} from './types.js';

/**
 * The file capability family, all from real filesystem facts (names and
 * kinds; contents only for an explicit "what is it" or "where is X in it"):
 *
 *   file.list    what is in a folder ("list files", "what files are here")
 *   file.browse  a navigable list: folders open in place, files open in the editor
 *   file.find    paths matching a name, extension or kind ("find tsconfig", "all typescript files")
 *   file.open    one file, a folder (browsed), an ordinal referent, or bare "open" (the picker)
 *
 * Listed results become referents, so "open the second one" and "what is it"
 * keep their meaning. Nothing here runs a command.
 */

const PLACE = String.raw`(?:here|in here|(?:in |of )?(?:this|the|my|our|current|working)\s+(?:folder|directory|dir|repo|repository|project|codebase|workspace)|in (?:the )?repo|in (?:this|my) (?:repo|project)|current directory|cwd)`;
const FILE_NOUN = String.raw`(?:files?|everything|contents|stuff|things|entries|items)`;
const LIST_VERB = String.raw`(?:list|ls|show|see|display|view|print|what|which|tell me|browse|give me)`;
/** Words that make a request about Git state, transcripts or config rather than plain files. */
const NOT_FILES = /\b(?:untracked|staged|unstaged|modified|changed|changes|diff|conflicts?|commits?|transcript|output|history|sessions?|config(?:uration)?|settings|providers?|brew|packages?|processes|running|ports?)\b/u;
const QUESTION = /^(?:please )?(?:how (?:do|can|would|should) i|how to|what does|what is the syntax|what's the syntax|explain)\b/u;

const ORDINALS: Record<string, number> = {first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10};

/** "the second one", "number 3", "#2", "the last one" → 1-based index or 'last'. */
export function ordinalIn(text: string): number | 'last' | undefined {
  const word = /\bthe (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)) (?:one|file|item|entry|path|result|match)\b/u.exec(text)
    ?? /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) (?:one|file|item|entry|path|result|match)\b/u.exec(text);
  if (word) return ORDINALS[word[1]!];
  const number = /\b(?:number|no\.?|#)\s*(\d{1,3})\b/u.exec(text) ?? /^(?:open|show|use|pick|take)\s+(\d{1,3})$/u.exec(text);
  if (number) return Number(number[1]);
  if (/\bthe last (?:one|file|item|entry|result)\b/u.test(text)) return 'last';
  return undefined;
}

/** Kinds of file people name in words, by extension. */
const KINDS: Array<{words: RegExp; label: string; extensions: string[]}> = [
  {words: /\btype ?script\b|\bts files?\b/u, label: 'TypeScript', extensions: ['.ts', '.tsx', '.mts', '.cts']},
  {words: /\bjava ?script\b|\bjs files?\b/u, label: 'JavaScript', extensions: ['.js', '.jsx', '.mjs', '.cjs']},
  {words: /\bpython\b|\bpy files?\b/u, label: 'Python', extensions: ['.py']},
  {words: /\brust\b|\brs files?\b/u, label: 'Rust', extensions: ['.rs']},
  {words: /\bgo files?\b|\bgolang\b/u, label: 'Go', extensions: ['.go']},
  {words: /\bmarkdown\b|\bmd files?\b|\bdocs?\b/u, label: 'Markdown', extensions: ['.md', '.mdx']},
  {words: /\bjson\b/u, label: 'JSON', extensions: ['.json', '.jsonc']},
  {words: /\byaml\b|\byml\b/u, label: 'YAML', extensions: ['.yaml', '.yml']},
  {words: /\btoml\b/u, label: 'TOML', extensions: ['.toml']},
  {words: /\bshell scripts?\b|\bsh files?\b/u, label: 'Shell', extensions: ['.sh', '.zsh', '.bash', '.fish']},
  {words: /\bimages?\b|\bpictures?\b/u, label: 'Image', extensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']},
  {words: /\btests?\b|\bspecs?\b/u, label: 'Test', extensions: []},
];

const display = (path: string, context: AskContext): string => {
  const base = context.repoRoot ?? context.cwd;
  const rel = relative(base, path);
  if (rel === '') return '.';
  if (!rel.startsWith('..') && !isAbsolute(rel)) return rel;
  return path.startsWith(`${context.home}/`) ? `~${path.slice(context.home.length)}` : path;
};
const home = (path: string, context: AskContext) => path === context.home ? '~' : path.startsWith(`${context.home}/`) ? `~${path.slice(context.home.length)}` : path;

const isDirectory = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };

export function openProposal(path: string, context: AskContext, direct = false): AskOutcome {
  return {kind: 'proposal', capability: 'file.open', safety: 'navigate', confidence: 0.92, ...(direct ? {direct: true} : {}),
    text: `Open ${display(path, context)} in ${context.editor.label}?`, action: {kind: 'openFile', path}, referents: {file: path}};
}

/**
 * A folder as a navigable list (Ask's own picker): folders first, then files;
 * ↑↓ select, Enter opens (a folder lists in place, a file opens in the
 * editor), typing filters. The entries become the conversation's referents.
 */
export function browseOutcome(directory: string, context: AskContext, options: {hidden?: boolean; note?: string} = {}): AskOutcome {
  const entries = listDirectory(directory, {hidden: options.hidden, limit: 400}) ?? [];
  const paths = entries.map(entry => join(directory, entry.name));
  const where = home(directory, context);
  const parent = resolve(directory, '..');
  const root = context.repoRoot ?? context.cwd;
  const up: AskOption[] = directory !== root && directory !== '/' && !relative(root, directory).startsWith('..')
    ? [{key: 'browse:..', label: '../', detail: 'up', refine: `browse ${parent}`}] : [];
  if (!entries.length) {
    return {kind: 'answer', capability: 'file.browse', text: `${where} is empty${options.hidden ? '' : ' (hidden files not shown)'}.`, referents: {files: {paths: [], kind: 'listed'}, directory}};
  }
  const folders = entries.filter(entry => entry.directory).length;
  const summary = `${entries.length - folders} file${entries.length - folders === 1 ? '' : 's'}, ${folders} folder${folders === 1 ? '' : 's'}${options.hidden ? ' (including hidden)' : ''}`;
  return {kind: 'choose', reason: 'missing', capability: 'file.browse', question: `Files · ${where}\n${summary}${options.note ? ` · ${options.note}` : ''}`,
    options: [...up, ...entries.map((entry, index) => {
      const path = paths[index]!;
      return entry.directory
        ? {key: `browse:${path}`, label: `${entry.name}/`, refine: `browse ${path}`}
        : {key: `file:${path}`, label: entry.name, outcome: openProposal(path, context, true)};
    })],
    referents: {files: {paths, kind: 'listed'}, directory}};
}

/** Paths as a numbered, openable list (find results). */
function listOutcome(title: string, paths: string[], context: AskContext, total = paths.length): AskOutcome {
  return {kind: 'choose', reason: 'missing', capability: 'file.find', question: `${title}${total > paths.length ? ` · first ${paths.length} of ${total}` : ''}`,
    options: paths.map(path => isDirectory(path)
      ? {key: `browse:${path}`, label: `${display(path, context)}/`, refine: `browse ${path}`}
      : {key: `file:${path}`, label: display(path, context), outcome: openProposal(path, context, true)}),
    referents: {files: {paths, kind: 'listed'}}};
}

/** The folder a list request names: "here" is the working folder; "repo"/"project" is the repository root; "in src" is that folder. */
function placeIn(text: string, raw: string, context: AskContext): string | undefined {
  const named = /\b(?:in|inside|under|of)\s+([\w./~-]+\/?)\s*$/u.exec(text);
  if (named && !/^(?:here|this|the|my|our|repo|repository|project|folder|directory|codebase|workspace)$/u.test(named[1]!)) {
    const candidate = named[1]!.startsWith('~/') ? join(context.home, named[1]!.slice(2)) : resolve(context.cwd, named[1]!);
    if (isDirectory(candidate)) return candidate;
    const root = context.repoRoot ?? context.cwd;
    const inRoot = resolve(root, named[1]!);
    if (isDirectory(inRoot)) return inRoot;
  }
  void raw;
  if (/\b(?:repo|repository|project|codebase|workspace)\b/u.test(text) && context.repoRoot) return context.repoRoot;
  return undefined;
}

/** Strip the verb and filler from a find/open request: what remains names the file. */
function nameIn(text: string, verb: RegExp): string {
  return text.replace(verb, ' ')
    .replace(/\b(?:the|my|a|an|me|please|file|files|folder|directory|called|named|for|is|are|located|at|can you|could you|help|to|i|want|where|in (?:here|this (?:repo|project|folder))|in (?:zed|vs ?code|my editor|the editor))\b/gu, ' ')
    .replace(/[?]/gu, '').replace(/\s+/gu, ' ').trim();
}

/** Bounded facts about one file for "what is it". */
function describeFile(path: string, context: AskContext): AskOutcome {
  let size = 0;
  try { size = statSync(path).size; } catch {
    return {kind: 'answer', capability: 'file.open', text: `${display(path, context)} no longer exists.`};
  }
  if (isDirectory(path)) return browseOutcome(path, context);
  const head = readHead(path, 64 * 1024);
  const binary = head.includes('\u0000');
  const lines = binary ? undefined : head.split('\n').length - (head.endsWith('\n') ? 1 : 0);
  const kind = KNOWN_FILES[basename(path)] ?? EXTENSIONS[extname(path).toLowerCase()] ?? (binary ? 'Binary file' : 'Text file');
  const sizeText = size < 1024 ? `${size} bytes` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
  const lineText = lines === undefined ? '' : size > head.length ? ` · ${lines}+ lines` : ` · ${lines} line${lines === 1 ? '' : 's'}`;
  return {kind: 'answer', capability: 'file.open', text: `${display(path, context)}\n${kind} · ${sizeText}${lineText}`,
    follow: {key: `file:${path}`, label: `Open in ${context.editor.label}`, outcome: openProposal(path, context, true)}, referents: {file: path}};
}

function readHead(path: string, bytes: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) closeSync(fd); }
}

const KNOWN_FILES: Record<string, string> = {'package.json': 'Node.js package manifest (scripts, dependencies)', 'tsconfig.json': 'TypeScript compiler configuration',
  'README.md': 'Project readme (Markdown)', 'Cargo.toml': 'Rust package manifest', 'pyproject.toml': 'Python project configuration', 'go.mod': 'Go module definition',
  'Makefile': 'Make build rules', 'Dockerfile': 'Docker image definition', '.gitignore': 'Git ignore rules', 'package-lock.json': 'npm lockfile',
  'pnpm-lock.yaml': 'pnpm lockfile', 'yarn.lock': 'Yarn lockfile', 'bun.lockb': 'Bun lockfile', 'LICENSE': 'License text', 'AGENTS.md': 'Instructions for coding agents (Markdown)'};
const EXTENSIONS: Record<string, string> = {'.ts': 'TypeScript source', '.tsx': 'TypeScript (JSX) source', '.js': 'JavaScript source', '.mjs': 'JavaScript module',
  '.json': 'JSON', '.md': 'Markdown', '.py': 'Python source', '.rs': 'Rust source', '.go': 'Go source', '.sh': 'Shell script', '.zsh': 'zsh script', '.fish': 'fish script',
  '.toml': 'TOML', '.yaml': 'YAML', '.yml': 'YAML', '.css': 'CSS', '.html': 'HTML', '.png': 'PNG image', '.jpg': 'JPEG image', '.svg': 'SVG image', '.txt': 'Plain text'};

/** Lines in one file containing a literal term (bounded; the file is only read). */
function searchIn(path: string, term: string, context: AskContext): AskOutcome {
  const text = readHead(path, 2 * 1024 * 1024);
  const needle = term.toLowerCase();
  const hits: string[] = [];
  let count = 0;
  text.split('\n').forEach((line, index) => {
    if (!line.toLowerCase().includes(needle)) return;
    count += 1;
    if (hits.length < 12) hits.push(`${String(index + 1).padStart(5)}  ${line.trim().slice(0, 120)}`);
  });
  if (!count) return {kind: 'answer', capability: 'file.find', text: `"${term}" doesn't appear in ${display(path, context)}.`, referents: {file: path}};
  return {kind: 'answer', capability: 'file.find', text: `"${term}" in ${display(path, context)} · ${count} line${count === 1 ? '' : 's'}\n${hits.join('\n')}${count > hits.length ? `\n  … ${count - hits.length} more` : ''}`,
    follow: {key: `file:${path}`, label: `Open in ${context.editor.label}`, outcome: openProposal(path, context, true)}, referents: {file: path}};
}

/** Project files (bounded list) matching a kind or a name fragment. */
function findPaths(context: AskContext, predicate: (relativePath: string) => boolean): {paths: string[]; total: number} {
  const root = context.repoRoot ?? context.cwd;
  const all = (context.files ?? []).filter(predicate);
  return {paths: all.slice(0, 60).map(path => join(root, path)), total: all.length};
}

export function resolveFiles(text: string, raw: string, context: AskContext): AskOutcome | undefined {
  if (QUESTION.test(text)) return undefined;
  const referents = context.referents;
  const listed = referents?.files?.paths ?? [];

  // "browse <dir>" (what folder entries refine to).
  const browse = /^browse\s+(.+)$/u.exec(raw.trim());
  if (browse) {
    const path = resolve(context.cwd, browse[1]!.trim());
    return isDirectory(path) ? browseOutcome(path, context) : undefined;
  }

  // Ordinal referents: "open the second one", "what is the third one".
  const ordinal = ordinalIn(text);
  if (ordinal !== undefined && listed.length && /^(?:please )?(?:open|edit|view|show|use|pick|take|select|what(?: is)?|describe|go to|cd|browse|the|number)\b|\bone$/u.test(text)) {
    const index = ordinal === 'last' ? listed.length - 1 : ordinal - 1;
    const path = listed[index];
    if (!path) return {kind: 'answer', capability: 'file.open', text: `There are only ${listed.length} in the list.`};
    // Revalidated: the path must still exist before anything is done with it.
    if (!isFile(path) && !isDirectory(path)) return {kind: 'answer', capability: 'file.open', text: `${display(path, context)} no longer exists.`};
    if (/^(?:what|describe)\b/u.test(text)) return describeFile(path, context);
    if (isDirectory(path)) return browseOutcome(path, context);
    return openProposal(path, context);
  }

  // "what is it" / "what is that file": the file this conversation is about.
  if (referents?.file && /^(?:what(?: is| does)?|describe|tell me about)\s+(?:it|that|this|that file|this file|it do)$/u.test(text)) return describeFile(referents.file, context);
  // "show me where foo is in it", "find foo in it", "search it for foo".
  if (referents?.file) {
    const inside = /^(?:show(?: me)?|find|search|grep|where)\b.*?\b(?:where\s+)?["']?([^"'\s]+)["']?\s+(?:is|appears|shows up)?\s*(?:in|inside)\s+(?:it|that|this|that file|this file|there)$/u.exec(text)
      ?? /^search (?:it|that|that file|this file) for\s+["']?([^"'\s]+)["']?$/u.exec(text);
    if (inside && inside[1] && !/^(?:me|it|where)$/u.test(inside[1])) return searchIn(referents.file, inside[1], context);
  }

  if (NOT_FILES.test(text) && !/\b(?:named|called|matching)\b/u.test(text)) return undefined;

  // Bare "open", "open a file", "open something": the picker.
  if (/^(?:please )?(?:open|pick|choose|edit)(?: (?:a|any|some) ?(?:file|thing)?|something| one| up)?$/u.test(text)) {
    const root = context.repoRoot ?? context.cwd;
    if (context.picker && context.picker !== 'native') {
      return {kind: 'proposal', capability: 'file.open', safety: 'navigate', confidence: 0.9, direct: true,
        text: `Pick a file in ${home(root, context)}.`, action: {kind: 'pickFile', root}};
    }
    return browseOutcome(context.cwd, context, {note: 'type to filter'});
  }

  // Listing: "list files", "ls files", "show me the files here", "what files are in this folder", "list everything in this repo", "list hidden files".
  const hidden = /\b(?:hidden|dot ?files|all)\b/u.test(text) && /\b(?:hidden|dot ?files)\b/u.test(text);
  const listing = new RegExp(String.raw`^(?:please |can you |could you |help me |can you help me |i want to |let me )*(?:${LIST_VERB})\b.*\b${FILE_NOUN}\b`, 'u').test(text)
    || new RegExp(String.raw`\b${FILE_NOUN}\b.*\b(?:are )?${PLACE}`, 'u').test(text)
    || /^(?:ls|ll|la|dir|files)$/u.test(text)
    || /^(?:open|show|see|view) (?:the |my )?files\b/u.test(text);
  const kind = KINDS.find(item => item.words.test(text));
  if (listing && !kind) {
    const directory = placeIn(text, raw, context) ?? context.cwd;
    return browseOutcome(directory, context, {hidden});
  }

  // Finding by kind: "show me all typescript files", "find the tests".
  if (kind && (listing || /^(?:find|locate|search for|where are)\b/u.test(text))) {
    const predicate = kind.extensions.length ? (path: string) => kind.extensions.includes(extname(path).toLowerCase())
      : (path: string) => /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[a-z]+$/u.test(path);
    const {paths, total} = findPaths(context, predicate);
    if (!total) return {kind: 'answer', capability: 'file.find', text: `No ${kind.label} files under ${home(context.repoRoot ?? context.cwd, context)}.`};
    return listOutcome(`${kind.label} files · ${total}`, paths, context, total);
  }

  // "find files named config", "find tsconfig", "where is the readme", "locate package.json".
  const find = /^(?:please )?(?:find|locate|search for|look for|where(?: is|'s| are)?|which file is)\b/u.test(text);
  if (find) {
    const explicitName = /\b(?:named|called|matching|with)\s+["']?([\w.*-]+)["']?/u.exec(text)?.[1];
    const query = explicitName ?? nameIn(text, /^(?:please )?(?:find|locate|search for|look for|where(?: is|'s| are)?|which file is)\b/u);
    if (!query || query.split(' ').length > 3) return undefined;
    const root = context.repoRoot ?? context.cwd;
    const needle = query.toLowerCase().replace(/\*/gu, '');
    const byName = (context.files ?? []).filter(path => basename(path).toLowerCase().includes(needle));
    const matched = byName.length ? byName.map(path => join(root, path)) : matchFiles(query, context.files ?? [], context.cwd, root).map(match => match.path);
    // Folders named like it too ("find src").
    const folders = (listDirectory(root) ?? []).filter(entry => entry.directory && entry.name.toLowerCase().includes(needle) && !NOISY_DIRECTORIES.has(entry.name)).map(entry => join(root, entry.name));
    const all = [...folders, ...matched];
    // A plain find that matches nothing is not a file request ("find error" searches the transcript).
    if (!all.length) return explicitName ? {kind: 'answer', capability: 'file.find', text: `No file named like "${query}" under ${home(root, context)}.`} : undefined;
    if (all.length === 1 && /^where/u.test(text)) {
      return {kind: 'answer', capability: 'file.find', text: `${display(all[0]!, context)}`, follow: {key: `file:${all[0]}`, label: `Open in ${context.editor.label}`, outcome: openProposal(all[0]!, context, true)},
        referents: {file: all[0]!, files: {paths: all, kind: 'listed'}}};
    }
    return listOutcome(`Matches for "${query}" · ${all.length}`, all.slice(0, 60), context, all.length);
  }

  // "open src", "open the tests folder": a folder browses in place.
  const open = /^(?:please )?(?:open|browse|go into|show)\s+(.+)$/u.exec(text);
  if (open) {
    const name = open[1]!.replace(/\b(?:the|my|folder|directory|dir)\b/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (name && !/\s/u.test(name)) {
      const candidate = name.startsWith('~/') ? join(context.home, name.slice(2)) : resolve(context.cwd, name);
      const inRoot = context.repoRoot ? resolve(context.repoRoot, name) : candidate;
      const directory = isDirectory(candidate) ? candidate : isDirectory(inRoot) ? inRoot : undefined;
      if (directory) return browseOutcome(directory, context);
    }
  }
  return undefined;
}
