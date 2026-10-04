/**
 * Paste Preview / Paste Guard. Ordinary single-line pastes insert at once;
 * a paste that is multiline, chains several commands, mutates, destroys,
 * escalates privilege, pipes downloaded text into an interpreter, or is
 * unusually large is shown first (muted, above the composer) with Insert /
 * Review / Cancel. Classification is for display only: what is inserted is
 * exactly what was pasted, and nothing runs until the person presses Enter.
 */
export type PasteKind = 'navigation' | 'read' | 'install' | 'modifies' | 'destructive' | 'privilege' | 'network' | 'pipeline' | 'command';

export interface PasteCommand {
  /** The command's text as written (display only). */
  text: string;
  kinds: PasteKind[];
}

export interface PasteAnalysis {
  /** Commands as the shell would separate them (newlines, ; && || |, respecting quotes). */
  commands: PasteCommand[];
  lines: number;
  characters: number;
  operators: number;
}

export type PastePreviewMode = 'smart' | 'always' | 'off';
export const PASTE_PREVIEW_MODES: readonly PastePreviewMode[] = ['smart', 'always', 'off'];

/** Split shell text into commands at newlines and ; && || | outside quotes, comments and escapes. */
export function splitCommands(text: string): Array<{text: string; pipedFrom: boolean; pipesTo: boolean}> {
  const out: Array<{text: string; pipedFrom: boolean; pipesTo: boolean}> = [];
  let current = '';
  let quote: '"' | '\'' | '`' | undefined;
  let pipedFrom = false;
  const push = (pipesTo: boolean) => {
    const trimmed = current.trim();
    if (trimmed) out.push({text: trimmed, pipedFrom, pipesTo});
    pipedFrom = pipesTo;
    current = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];
    if (quote) {
      current += char;
      if (char === '\\' && quote !== '\'' && next !== undefined) { current += next; index += 1; continue; }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '\\' && next !== undefined) { current += char + next; index += 1; continue; }
    if (char === '"' || char === '\'' || char === '`') { quote = char; current += char; continue; }
    if (char === '#' && (current === '' || /\s$/u.test(current))) { while (index < text.length && text[index] !== '\n') index += 1; push(false); continue; }
    if (char === '\n' || char === ';') { push(false); continue; }
    if (char === '&' && next === '&') { push(false); index += 1; continue; }
    if (char === '|' && next === '|') { push(false); index += 1; continue; }
    if (char === '|') { push(true); continue; }
    current += char;
  }
  push(false);
  return out;
}

const INTERPRETERS = /^(?:sh|bash|zsh|fish|dash|ksh|python3?|node|perl|ruby|eval|source|\.)$/u;

/** Words of one command (quotes removed for classification only). */
function words(text: string): string[] {
  return text.match(/"(?:\\.|[^"])*"|'[^']*'|\S+/gu)?.map(word => word.replace(/^["']|["']$/gu, '')) ?? [];
}

export function classifyCommand(text: string, pipedFrom: boolean): PasteKind[] {
  const all = words(text);
  // Leading env assignments and sudo-like prefixes.
  const kinds = new Set<PasteKind>();
  let index = 0;
  while (/^\w+=/u.test(all[index] ?? '')) index += 1;
  while (/^(?:sudo|doas|su|pkexec)$/u.test(all[index] ?? '')) { kinds.add('privilege'); index += 1; while ((all[index] ?? '').startsWith('-')) index += 1; }
  const [command = '', ...rest] = all.slice(index);
  const sub = rest.find(word => !word.startsWith('-')) ?? '';
  const flags = rest.filter(word => word.startsWith('-')).join(' ');
  if (pipedFrom && INTERPRETERS.test(command)) kinds.add('pipeline');
  if (/<\(\s*(?:curl|wget)\b/u.test(text) || /\$\(\s*(?:curl|wget)\b/u.test(text)) kinds.add('pipeline');
  if (/^(?:curl|wget|http|https|nc|ssh|scp|rsync|ftp)$/u.test(command)) kinds.add('network');
  if (/^(?:cd|pushd|popd|z|zi)$/u.test(command)) kinds.add('navigation');
  else if (/^(?:ls|ll|la|cat|less|more|head|tail|pwd|echo|printf|grep|rg|fd|which|type|whoami|date|wc|tree|stat|file|env|printenv|history|man|tldr)$/u.test(command)) kinds.add('read');
  if (command === 'find' && /-(?:delete|exec|execdir|ok)\b/u.test(text)) kinds.add('destructive');
  else if (command === 'find') kinds.add('read');
  if (command === 'git') {
    if (/^(?:status|log|diff|show|branch|remote|fetch|blame|ls-files)$/u.test(sub) && !/(?:-D|--delete|-d)\b/u.test(flags)) kinds.add('read');
    else if ((sub === 'reset' && /--hard/u.test(flags)) || (sub === 'clean' && /-\w*f/u.test(flags)) || (sub === 'push' && /(?:-f\b|--force)/u.test(flags))
      || (sub === 'checkout' && rest.includes('--')) || sub === 'filter-branch' || (sub === 'branch' && /-D/u.test(flags))) kinds.add('destructive');
    else kinds.add('modifies');
  }
  if (/^(?:npm|pnpm|yarn|bun)$/u.test(command) && /^(?:install|i|add|ci|update|upgrade|remove|uninstall|rm)$/u.test(sub)) kinds.add('install');
  if (/^(?:brew|apt|apt-get|dnf|yum|pacman|zypper|apk|port|snap|flatpak)$/u.test(command) && /^(?:install|reinstall|upgrade|remove|uninstall|purge|erase|-S|-R)$/u.test(sub)) kinds.add('install');
  if (/^(?:pip|pip3|pipx|gem|cargo|go)$/u.test(command) && /^(?:install|uninstall)$/u.test(sub)) kinds.add('install');
  if (command === 'rm' || command === 'rmdir' || command === 'shred' || command === 'mkfs' || /^mkfs\./u.test(command) || command === 'dd' || command === 'truncate'
    || ((command === 'chmod' || command === 'chown') && /-\w*R/u.test(flags)) || /\bkill(?:all)?\b/u.test(command) || /:\(\)\s*\{/u.test(text)) kinds.add('destructive');
  if (/^(?:mv|cp|mkdir|touch|ln|tee|sed|perl|install|chmod|chown|patch|unzip|tar)$/u.test(command) && !kinds.has('destructive')) {
    if (command !== 'sed' || /-i\b|--in-place/u.test(flags)) kinds.add('modifies');
  }
  if (/(?:^|[^>&])>>?\s*[^\s&|]/u.test(text.replace(/"(?:\\.|[^"])*"|'[^']*'/gu, '""')) && !/>\s*\/dev\/null/u.test(text)) kinds.add('modifies');
  if (!kinds.size) kinds.add('command');
  return [...kinds];
}

export function analyzePaste(text: string): PasteAnalysis {
  const split = splitCommands(text);
  const outside = text.replace(/"(?:\\.|[^"])*"|'[^']*'/gu, '""');
  return {commands: split.map(item => ({text: item.text, kinds: classifyCommand(item.text, item.pipedFrom)})),
    lines: text.replace(/\r\n?/gu, '\n').split('\n').filter(line => line.trim()).length, characters: text.length,
    operators: (outside.match(/&&|\|\||;|\||\$\(|`/gu) ?? []).length};
}

const ATTENTION: ReadonlySet<PasteKind> = new Set(['destructive', 'privilege', 'pipeline', 'install']);

/** Smart: preview only what is worth a second look. Ordinary single commands insert at once. */
export function needsPreview(analysis: PasteAnalysis, mode: PastePreviewMode): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return analysis.characters > 0;
  return analysis.lines > 1 || analysis.commands.length > 1 || analysis.characters > 2000 || analysis.operators >= 3
    || analysis.commands.some(command => command.kinds.some(kind => ATTENTION.has(kind) || kind === 'modifies' && command.kinds.includes('network')));
}

export const KIND_LABELS: Record<PasteKind, string> = {navigation: 'navigation', read: 'read-only', install: 'installs packages', modifies: 'modifies files',
  destructive: 'destructive', privilege: 'runs as root', network: 'network', pipeline: 'runs downloaded code', command: 'command'};

/** The most important classification of a command, for its one-word label. */
export function primaryKind(kinds: readonly PasteKind[]): PasteKind {
  const order: PasteKind[] = ['pipeline', 'destructive', 'privilege', 'install', 'modifies', 'network', 'navigation', 'read', 'command'];
  return order.find(kind => kinds.includes(kind)) ?? 'command';
}
