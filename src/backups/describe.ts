import {basename, join, relative, sep} from 'node:path';
import {ABSENT_HASH, type JournalEntry, type JournalFile, type TransactionState} from './journal.js';

/** Plain words for a reconciled transaction state; the same wording in history, details and restore review. */
export function describeState(state: TransactionState): string {
  switch (state) {
    case 'applied': return 'applied';
    case 'in-progress': return 'still being written by another NMSh process';
    case 'not-applied': return 'interrupted before any file was written (the files still hold their backed-up bytes)';
    case 'partially-applied': return 'interrupted part-way: some files were written, others were not';
    case 'applied-unfinalized': return 'interrupted after every file was written, before it was marked done';
    case 'conflicted': return 'interrupted, and a file was changed by something else since';
    case 'reverted': return 'rolled back (files returned to their backed-up state)';
    case 'rollback-incomplete': return 'failed, and its rollback was incomplete';
    case 'partial': return 'partly applied (some areas failed or were skipped)';
    case 'indeterminate': return 'unfinished, and a file cannot be read safely to check it';
    case 'reviewed': return 'reviewed and set aside (files left as they were)';
  }
}

/** Whether an entry needs the user's review before it can be trusted as finished. */
export const needsReview = (state: TransactionState) => !['applied', 'reverted', 'in-progress', 'reviewed'].includes(state);


/** `~/…` inside the home; the absolute path elsewhere. */
export function displayPath(path: string, home: string): string {
  const inside = relative(home, path);
  return inside && !inside.startsWith('..') && !inside.startsWith(sep) ? `~/${inside}` : path;
}

/** The application a configuration file belongs to, from its location only (nothing is read). */
export function applicationOf(path: string, configDirectory: string): string {
  const own = relative(configDirectory, path);
  if (own && !own.startsWith('..')) {
    if (own === 'config.json') return 'NMSh settings';
    if (own === join('theme-bridge', 'ledger.json')) return 'Theme Bridge record';
    if (own.startsWith(join('theme-bridge', 'vim'))) return 'Vim colors';
    if (own.startsWith(join('theme-bridge', 'nvim'))) return 'Neovim colors';
    if (own.startsWith(join('theme-bridge', 'tmux'))) return 'tmux';
    if (own.startsWith(join('theme-bridge', 'vivid'))) return 'File listing colors';
    if (own.startsWith('agent-context')) return 'Claude Code status line';
    if (/kitty/u.test(own)) return /shader/u.test(own) ? 'Kitty shaders' : 'Kitty';
    if (/ghostty/u.test(own)) return /shader|glsl/u.test(own) ? 'Ghostty shaders' : 'Ghostty';
    return 'NMSh';
  }
  const lower = path.toLowerCase(), name = basename(lower);
  if (lower.includes(`${sep}kitty${sep}`) || name.startsWith('kitty')) return 'Kitty';
  if (lower.includes('ghostty')) return 'Ghostty';
  if (lower.includes(`${sep}nvim${sep}`)) return 'Neovim';
  if (name === '.vimrc' || lower.includes(`${sep}.vim${sep}`) || lower.includes(`${sep}vim${sep}`)) return 'Vim';
  if (lower.includes(`${sep}helix${sep}`)) return 'Helix';
  if (lower.includes(`${sep}bat${sep}`)) return 'bat';
  if (name.includes('tmux')) return 'tmux';
  if (name === 'starship.toml') return 'Starship';
  if (name === '.zshrc' || name === '.zprofile') return 'zsh';
  if (name === '.bashrc' || name === '.bash_profile') return 'Bash';
  if (lower.includes(`${sep}fish${sep}`)) return 'Fish';
  if (lower.includes(`${sep}.claude${sep}`)) return 'Claude Code';
  return basename(path);
}

export type FileAction = 'created' | 'changed' | 'removed' | 'checkpoint';
export function fileAction(file: JournalFile): FileAction {
  if (file.beforeHash === file.afterHash && (file.afterMode === undefined || file.afterMode === file.mode)) return 'checkpoint';
  if (!file.existed) return 'created';
  return file.afterHash === ABSENT_HASH ? 'removed' : 'changed';
}

const KIND: Record<string, string> = {reset: 'Reset', restore: 'Restore', manual: 'Manual snapshot', settings: 'Daily settings checkpoint'};
/** NMSh's own bookkeeping files are mentioned, but never named as the thing a change was about. */
const bookkeeping = (path: string, configDirectory: string) => {
  const own = relative(configDirectory, path);
  return own === 'config.json' || own === join('theme-bridge', 'ledger.json') || (!own.startsWith('..') && own.endsWith('.json') && !own.includes(sep + 'agent-context'));
};

/** One readable line per entry: when, which application and file, what happened. Labels stay as secondary detail. */
export function describeEntry(entry: JournalEntry, configDirectory: string): {when: string; what: string; action: string} {
  const date = new Date(entry.time);
  const pad = (value: number) => String(value).padStart(2, '0');
  const when = Number.isNaN(date.getTime()) ? entry.time : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const primary = entry.files.find(file => !bookkeeping(file.path, configDirectory) && fileAction(file) !== 'checkpoint')
    ?? entry.files.find(file => fileAction(file) !== 'checkpoint') ?? entry.files[0];
  const others = entry.files.filter(file => file !== primary && fileAction(file) !== 'checkpoint').length;
  const target = primary ? `${applicationOf(primary.path, configDirectory)} · ${basename(primary.path)}${others ? ` +${others} more` : ''}` : 'no files';
  const kind = KIND[entry.source];
  const what = kind ? `${kind}${entry.source === 'manual' ? ` of ${entry.files.length} files` : ` · ${target}`}` : target;
  const actions = new Set(entry.files.map(fileAction).filter(action => action !== 'checkpoint'));
  const action = !actions.size ? 'checkpoint' : actions.size === 1 ? [...actions][0]! : 'changed';
  return {when, what, action};
}

/** Local calendar day for grouping history. */
export function localDay(time: string): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return time.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
