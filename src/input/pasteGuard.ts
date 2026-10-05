/**
 * Paste Preview / Paste Guard. Ordinary single-line pastes insert at once;
 * a paste that is multiline, chains several commands, mutates, destroys,
 * escalates privilege, pipes downloaded text into an interpreter, or is
 * unusually large is shown first (muted, above the composer) with Insert /
 * Review / Cancel. Classification is for display only: what is inserted is
 * exactly what was pasted, and nothing runs until the person presses Enter.
 */
export type PasteKind = 'text' | 'unknown' | 'navigation' | 'read' | 'project' | 'network' | 'install' | 'modifies' | 'destructive' | 'privilege' | 'pipeline';

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

const READ_COMMANDS = new Set(['ls', 'll', 'la', 'cat', 'less', 'more', 'head', 'tail', 'pwd', 'echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'fd', 'which', 'whereis', 'type',
  'whoami', 'id', 'groups', 'hostname', 'uname', 'date', 'cal', 'uptime', 'df', 'du', 'ps', 'top', 'htop', 'wc', 'tree', 'stat', 'file', 'env', 'printenv', 'history', 'man', 'tldr',
  'sort', 'uniq', 'diff', 'cmp', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink', 'jq', 'yq', 'bat', 'eza', 'lsof', 'sw_vers', 'arch', 'nproc', 'locale', 'true', 'false', 'clear']);
const NETWORK_COMMANDS = new Set(['curl', 'wget', 'http', 'https', 'nc', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'telnet', 'ping', 'dig', 'nslookup', 'traceroute', 'mtr']);
/** Everything above plus tools whose names ordinary prose would not start with; used to tell prose from shell input. */
const KNOWN_COMMANDS = new Set([...READ_COMMANDS, ...NETWORK_COMMANDS, 'cd', 'pushd', 'popd', 'z', 'zi', 'sudo', 'doas', 'su', 'pkexec', 'git', 'gh', 'nmsh', 'npm', 'pnpm', 'yarn', 'bun',
  'npx', 'pnpx', 'bunx', 'node', 'deno', 'tsx', 'tsc', 'python', 'python3', 'pip', 'pip3', 'pipx', 'poetry', 'uv', 'ruby', 'gem', 'bundle', 'rake', 'cargo', 'rustc', 'rustup', 'go',
  'make', 'cmake', 'ninja', 'java', 'javac', 'mvn', 'gradle', 'php', 'composer', 'swift', 'xcodebuild', 'docker', 'podman', 'kubectl', 'helm', 'terraform', 'ansible', 'aws', 'gcloud', 'az',
  'brew', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk', 'port', 'snap', 'flatpak', 'mv', 'cp', 'mkdir', 'rmdir', 'rm', 'touch', 'ln', 'tee', 'sed', 'awk', 'perl', 'install',
  'chmod', 'chown', 'patch', 'unzip', 'zip', 'tar', 'gzip', 'gunzip', 'find', 'xargs', 'kill', 'killall', 'pkill', 'dd', 'truncate', 'shred', 'mkfs', 'sh', 'bash', 'zsh', 'fish', 'dash',
  'ksh', 'eval', 'source', 'export', 'alias', 'unalias', 'unset', 'set', 'exit', 'sleep', 'time', 'test', 'open', 'code', 'vim', 'nvim', 'vi', 'nano', 'emacs', 'tmux', 'screen',
  'pbcopy', 'pbpaste', 'defaults', 'launchctl', 'systemctl', 'journalctl', 'service', 'jest', 'vitest', 'mocha', 'pytest', 'eslint', 'prettier', 'ssh-keygen', 'ssh-add', 'fzf', 'zoxide']);

const VERSION_QUERY = new Set(['--version', '-v', '-V', 'version', '--help', '-h', 'help']);
const NMSH_READ = new Set(['--version', '-v', '-V', 'version', '--help', '-h', 'help', 'doctor']);
/** Subcommands of the JS package managers that are not project scripts (pnpm/yarn/bun run a script for anything else). */
const PACKAGE_BUILTINS = new Set(['install', 'i', 'add', 'ci', 'update', 'upgrade', 'up', 'remove', 'uninstall', 'rm', 'ls', 'list', 'll', 'la', 'why', 'explain', 'outdated', 'audit',
  'view', 'info', 'show', 'search', 'publish', 'login', 'logout', 'whoami', 'config', 'root', 'prefix', 'bin', 'cache', 'link', 'unlink', 'pack', 'init', 'create', 'dlx', 'exec', 'x',
  'help', 'version', 'prune', 'dedupe', 'rebuild', 'doctor', 'completion', 'fund', 'help-search', 'pkg', 'set', 'get', 'unplug', 'patch', 'workspaces', 'workspace']);
const PACKAGE_READ = new Set(['ls', 'list', 'll', 'la', 'why', 'explain', 'root', 'prefix', 'bin', 'help', 'version', 'whoami']);
const PACKAGE_NETWORK = new Set(['view', 'info', 'show', 'search', 'outdated', 'audit', 'publish', 'login', 'logout', 'dlx', 'x', 'fund']);
const PACKAGE_RUN = new Set(['run', 'run-script', 'test', 't', 'tst', 'start', 'stop', 'restart']);
const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'and', 'or', 'in', 'for', 'with', 'this', 'that', 'it', 'you', 'we', 'i', 'my', 'your', 'on', 'be',
  'can', 'will', 'please', 'not', 'have', 'has', 'do', 'does', 'how', 'what', 'why', 'when', 'but', 'if', 'so', 'as', 'at', 'by', 'from', 'me', 'our', 'they', 'there', 'would', 'should']);

/**
 * Deterministic and cautious: ordinary sentences are labelled text, never
 * "command". Anything shell-shaped (operators, paths, flags, assignments, a
 * known executable first) is left to the command classifier. Unsure → false.
 */
export function looksLikeProse(line: string): boolean {
  const text = line.trim();
  if (!text || /^[./~$!#-]/u.test(text)) return false;
  if (/[|<>`$]|&&|\|\|/u.test(text)) return false;
  const parts = text.split(/\s+/u);
  const first = parts[0]!;
  if (KNOWN_COMMANDS.has(first) || /^\w+=/u.test(first) || first.includes('/')) return false;
  if (parts.length < 3) return false;
  const prose = /^[A-Z]/u.test(first) || parts.slice(0, -1).some(word => /[,:;!?]$/u.test(word)) || /[.!?]$/u.test(text) && parts.length >= 4;
  if (prose) return !parts.some(word => /^-{1,2}[A-Za-z]/u.test(word) || /^\w+=/u.test(word));
  const stop = parts.filter(word => STOPWORDS.has(word.toLowerCase().replace(/[^a-z]/gu, ''))).length;
  return parts.length >= 6 && stop >= 2 && !parts.some(word => /^-{1,2}[A-Za-z]/u.test(word) || word.includes('/') || /^\w+=/u.test(word));
}

const GIT_READ = /^(?:status|log|diff|show|blame|rev-parse|rev-list|describe|ls-files|ls-tree|cat-file|shortlog|grep|name-rev|merge-base|diff-tree|show-ref|for-each-ref|count-objects|check-ignore|var|whatchanged|help|version|reflog|ls-remote)$/u;

function gitKinds(sub: string, rest: string[], flags: string): PasteKind[] {
  const args = rest.filter(word => !word.startsWith('-'));
  if (sub === 'ls-remote') return ['network'];
  if (GIT_READ.test(sub)) return ['read'];
  if (/^(?:--version|-v|--help)$/u.test(sub)) return ['read'];
  if (sub === 'fetch') return ['network'];
  if (sub === 'branch') {
    if (/(?:^|\s)(?:-D|-d|--delete)\b/u.test(flags)) return ['destructive'];
    if (!args.slice(1).length && !/(?:^|\s)(?:-m|-M|-c|-C|--move|--copy|-u|--set-upstream-to|--unset-upstream|--edit-description)\b/u.test(flags)) return ['read'];
    return ['modifies'];
  }
  if (sub === 'remote') return !args.slice(1).length || /^(?:show|get-url)$/u.test(args[1] ?? '') ? ['read'] : ['modifies'];
  if (sub === 'tag') return !args.slice(1).length || /(?:^|\s)(?:-l|--list|-n)\b/u.test(flags) ? ['read'] : /(?:^|\s)(?:-d|--delete)\b/u.test(flags) ? ['destructive'] : ['modifies'];
  if (sub === 'stash') return /^(?:list|show)$/u.test(args[1] ?? '') ? ['read'] : /^(?:drop|clear)$/u.test(args[1] ?? '') ? ['destructive'] : ['modifies'];
  if (sub === 'config') return /(?:^|\s)(?:--get|--get-all|--list|-l|--show-origin)\b/u.test(flags) || args[1] === 'get' || args[1] === 'list' ? ['read'] : ['modifies'];
  if (sub === 'worktree') return args[1] === 'list' ? ['read'] : ['modifies'];
  if ((sub === 'reset' && /--hard/u.test(flags)) || (sub === 'clean' && /-\w*f/u.test(flags)) || (sub === 'push' && /(?:-f\b|--force)/u.test(flags))
    || (sub === 'checkout' && rest.includes('--')) || sub === 'filter-branch' || (sub === 'restore' && /--worktree|\.$/u.test(rest.join(' ')))) return ['destructive'];
  return ['modifies'];
}

function packageKinds(command: string, sub: string, rest: string[]): PasteKind[] {
  if (/^(?:install|i|add|ci|update|upgrade|up|remove|uninstall|rm)$/u.test(sub)) return ['install'];
  if (PACKAGE_READ.has(sub)) return ['read'];
  if (PACKAGE_NETWORK.has(sub)) return ['network'];
  if (sub === 'config') return /^(?:get|list|ls)$/u.test(rest.filter(word => !word.startsWith('-'))[1] ?? '') ? ['read'] : ['modifies'];
  if (PACKAGE_RUN.has(sub)) return ['project'];
  if (sub === '' ) return command === 'yarn' ? ['install'] : ['unknown'];
  // pnpm / yarn / bun run a package script for any other word (`yarn build`); npm needs `run`.
  if (command !== 'npm' && !PACKAGE_BUILTINS.has(sub)) return ['project'];
  if (sub === 'exec' || sub === 'pkg' || sub === 'init' || sub === 'create') return ['modifies'];
  return ['unknown'];
}

export function classifyCommand(text: string, pipedFrom: boolean): PasteKind[] {
  if (looksLikeProse(text)) return ['text'];
  const all = words(text);
  // Leading env assignments and sudo-like prefixes.
  const kinds = new Set<PasteKind>();
  let index = 0;
  while (/^\w+=/u.test(all[index] ?? '')) index += 1;
  while (/^(?:sudo|doas|su|pkexec)$/u.test(all[index] ?? '')) { kinds.add('privilege'); index += 1; while ((all[index] ?? '').startsWith('-')) index += 1; }
  const [command = '', ...rest] = all.slice(index);
  // git's global `-C <path>` / `-c k=v` options come before the subcommand.
  if (command === 'git') for (let at = 0; at < rest.length;) { if (rest[at] === '-C' || rest[at] === '-c') rest.splice(at, 2); else at += 1; }
  const sub = rest.find(word => !word.startsWith('-')) ?? '';
  const flags = rest.filter(word => word.startsWith('-')).join(' ');
  if (pipedFrom && INTERPRETERS.test(command)) kinds.add('pipeline');
  if (/<\(\s*(?:curl|wget)\b/u.test(text) || /\$\(\s*(?:curl|wget)\b/u.test(text)) kinds.add('pipeline');
  if (NETWORK_COMMANDS.has(command)) kinds.add('network');
  if (/^(?:cd|pushd|popd|z|zi)$/u.test(command)) kinds.add('navigation');
  else if (command === 'nmsh') {
    const first = rest[0] ?? '';
    if (NMSH_READ.has(first) && rest.length === 1) kinds.add('read');
    else if (first === 'uninstall') kinds.add('destructive');
    else if (first === 'config') kinds.add(rest[1] === 'import' || rest[1] === 'export' ? 'modifies' : 'unknown');
  }
  else if (rest.length === 1 && VERSION_QUERY.has(rest[0]!) && KNOWN_COMMANDS.has(command) && !/^(?:sudo|rm|mv|cp|dd|kill|killall|pkill|shred|su|doas)$/u.test(command)) kinds.add('read');
  else if (READ_COMMANDS.has(command)) kinds.add('read');
  if (command === 'find' && /-(?:delete|exec|execdir|ok)\b/u.test(text)) kinds.add('destructive');
  else if (command === 'find') kinds.add('read');
  if (command === 'git' && !kinds.size) for (const kind of gitKinds(sub, rest, flags)) kinds.add(kind);
  if (/^(?:npm|pnpm|yarn|bun)$/u.test(command) && !kinds.size) for (const kind of packageKinds(command, sub, rest)) kinds.add(kind);
  if (/^(?:npx|pnpx|bunx)$/u.test(command)) { kinds.add('network'); kinds.add('project'); }
  if (/^(?:make|cmake|ninja|gradle|mvn|rake|xcodebuild|pytest|jest|vitest|mocha)$/u.test(command) && !kinds.size) kinds.add('project');
  if (/^(?:cargo|go|deno|swift|dotnet|composer|poetry|uv)$/u.test(command) && /^(?:build|test|run|check|clippy|vet|bench|lint|fmt|doc|compile)$/u.test(sub) && !kinds.size) kinds.add('project');
  if (/^(?:\.\/|\.\.\/)/u.test(command) || (/^(?:node|tsx|python3?|ruby|bash|sh|zsh|perl|php)$/u.test(command) && sub && !kinds.has('pipeline'))) kinds.add('project');
  if (/^(?:brew|apt|apt-get|dnf|yum|pacman|zypper|apk|port|snap|flatpak)$/u.test(command) && /^(?:install|reinstall|upgrade|remove|uninstall|purge|erase|-S|-R)$/u.test(sub)) kinds.add('install');
  if (/^(?:pip|pip3|pipx|gem|cargo|go)$/u.test(command) && /^(?:install|uninstall)$/u.test(sub)) kinds.add('install');
  if (command === 'rm' || command === 'rmdir' || command === 'shred' || command === 'mkfs' || /^mkfs\./u.test(command) || command === 'dd' || command === 'truncate'
    || ((command === 'chmod' || command === 'chown') && /-\w*R/u.test(flags)) || /\bkill(?:all)?\b/u.test(command) || /:\(\)\s*\{/u.test(text)) kinds.add('destructive');
  if (/^(?:mv|cp|mkdir|touch|ln|tee|sed|perl|install|chmod|chown|patch|unzip|tar)$/u.test(command) && !kinds.has('destructive')) {
    if (command !== 'sed' || /-i\b|--in-place/u.test(flags)) { kinds.delete('read'); kinds.add('modifies'); }
  }
  if (/(?:^|[^>&])>>?\s*[^\s&|]/u.test(text.replace(/"(?:\\.|[^"])*"|'[^']*'/gu, '""')) && !/>\s*\/dev\/null/u.test(text)) kinds.add('modifies');
  if (!kinds.size) kinds.add('unknown');
  return [...kinds];
}

export function analyzePaste(text: string): PasteAnalysis {
  const normalized = text.replace(/\r\n?/gu, '\n');
  const rows = normalized.split('\n').filter(line => line.trim());
  // Ordinary sentences are text as a whole, before any shell splitting (apostrophes and semicolons are prose, not syntax).
  const prose = rows.length > 0 && rows.every(line => looksLikeProse(line));
  const split = prose ? rows.map(line => ({text: line.trim(), pipedFrom: false, pipesTo: false})) : splitCommands(text);
  const commands = split.length ? split.map(item => ({text: item.text, kinds: classifyCommand(item.text, item.pipedFrom)}))
    : rows.map(line => ({text: line.trim(), kinds: ['text'] as PasteKind[]}));
  const outside = text.replace(/"(?:\\.|[^"])*"|'[^']*'/gu, '""');
  return {commands, lines: rows.length, characters: text.length, operators: prose ? 0 : (outside.match(/&&|\|\||;|\||\$\(|`/gu) ?? []).length};
}


const ATTENTION: ReadonlySet<PasteKind> = new Set(['destructive', 'privilege', 'pipeline', 'install']);

/** Smart: preview only what is worth a second look. Ordinary single commands insert at once. */
export function needsPreview(analysis: PasteAnalysis, mode: PastePreviewMode): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return analysis.characters > 0;
  return analysis.lines > 1 || analysis.commands.length > 1 || analysis.characters > 2000 || analysis.operators >= 3
    || analysis.commands.some(command => command.kinds.some(kind => ATTENTION.has(kind) || kind === 'modifies' && command.kinds.includes('network')));
}

export const KIND_LABELS: Record<PasteKind, string> = {text: 'plain text', unknown: 'unrecognized shell input', navigation: 'navigation', read: 'read-only', project: 'runs project script',
  network: 'network', install: 'installs packages', modifies: 'modifies files', destructive: 'destructive', privilege: 'runs as root', pipeline: 'runs downloaded code'};

/** The most important classification of a command, for its one-word label. */
export function primaryKind(kinds: readonly PasteKind[]): PasteKind {
  const order: PasteKind[] = ['pipeline', 'destructive', 'privilege', 'install', 'modifies', 'network', 'project', 'navigation', 'read', 'unknown', 'text'];
  return order.find(kind => kinds.includes(kind)) ?? 'unknown';
}

/** The compact preview's header: what the paste is, without claiming more than was recognised. */
export function pasteHeader(analysis: PasteAnalysis): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const text = analysis.commands.filter(command => primaryKind(command.kinds) === 'text').length;
  const shell = analysis.commands.length - text;
  const size = analysis.characters > 2000 ? ` · ${analysis.characters} characters` : '';
  if (!shell) return `pasted · text · ${count(analysis.lines, 'line')}${size}`;
  const lead = analysis.commands.length === analysis.lines ? count(shell, 'shell line') : count(shell, 'command') + (analysis.lines > 1 ? ` · ${count(analysis.lines, 'line')}` : '');
  return `pasted · ${lead}${text ? ` · ${count(text, 'text line')}` : ''}${size}`;
}

/** Shown when the paste is not clearly an ordinary command: what the shell will receive does not change. */
export const PASTE_EXACT_NOTE = 'If inserted and submitted, your shell will still receive this text exactly.';
