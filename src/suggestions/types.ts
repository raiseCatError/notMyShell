import type {ProviderDescriptor} from '../providers/providers.js';

/**
 * Suggestions predict likely command text from behavior and context and are
 * shown as ghost text. They are not completions (structured candidates on
 * Tab). Providers only rank text; NMSh owns rendering, keys and acceptance,
 * and nothing a provider returns is ever executed.
 */
export type SuggestionProviderId = 'nmsh' | 'deja' | 'none';
export const SUGGESTION_PROVIDER_IDS: readonly SuggestionProviderId[] = ['nmsh', 'deja', 'none'];

export const SUGGESTION_PROVIDERS: readonly ProviderDescriptor<SuggestionProviderId>[] = [
  {id: 'nmsh', family: 'suggestions', label: 'NMSh Native', kind: 'native',
    description: 'fuzzy, frecency, directory and sequence prediction'},
  {id: 'none', family: 'suggestions', label: 'None', kind: 'none', description: 'no ghost text'},
];

export interface SuggestionContext {
  buffer: string;
  cwd: string;
  /** Commands submitted this session, most recent first. */
  previous: readonly string[];
  now: number;
}

export interface Suggestion {
  /** The full command line the provider predicts. */
  text: string;
  source: SuggestionProviderId;
  score: number;
}

/** A finished command a provider may learn from. */
export interface CommandEntry {
  command: string;
  cwd?: string;
  exitCode?: number;
  /** Epoch milliseconds. */
  at?: number;
  /** The command submitted just before this one. */
  previous?: string;
}

export interface SuggestionProvider {
  readonly id: SuggestionProviderId;
  /** Ranked candidates. Synchronous results render on the same keystroke. */
  query(context: SuggestionContext, signal: AbortSignal): Suggestion[] | Promise<Suggestion[]>;
  record?(entry: CommandEntry): void;
  dispose?(): void;
}

/** Converts a zsh HISTORY_IGNORE pattern (`(ls|cd *|pwd)`) into an anchored RegExp. */
export function historyIgnorePattern(pattern: string | undefined): RegExp | undefined {
  if (!pattern?.trim()) return undefined;
  let source = '';
  let depth = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === '\\' && index + 1 < pattern.length) source += `\\${pattern[++index]}`;
    else if (character === '*') source += '.*';
    else if (character === '?') source += '.';
    else if (character === '(') { depth += 1; source += '(?:'; }
    else if (character === ')') { if (depth > 0) { depth -= 1; source += ')'; } else source += '\\)'; }
    else if (character === '|') source += '|';
    else if (character === '[') {
      const close = pattern.indexOf(']', index + 2);
      if (close === -1) source += '\\[';
      else { source += `[${pattern.slice(index + 1, close).replace(/^!/u, '^').replace(/\\/gu, '\\\\')}]`; index = close; }
    } else source += character.replace(/[.+^${}]/gu, '\\$&');
  }
  if (depth !== 0) return undefined;
  try {
    return new RegExp(`^(?:${source})$`, 'u');
  } catch {
    return undefined;
  }
}

/** HISTORY_IGNORE and zsh-autosuggestions' ignore pattern, when exported to NMSh. */
export function ignorePatternFromEnv(env: NodeJS.ProcessEnv = process.env): RegExp | undefined {
  const patterns = [env.HISTORY_IGNORE, env.ZSH_AUTOSUGGEST_HISTORY_IGNORE].map(historyIgnorePattern).filter(Boolean) as RegExp[];
  return patterns.length > 1 ? new RegExp(patterns.map(pattern => pattern.source).join('|'), 'u') : patterns[0];
}

/** Commands that are never suggested or learned: blank, leading space, or matching HISTORY_IGNORE. */
export function isPrivateCommand(command: string, ignore?: RegExp): boolean {
  if (!command.trim() || /^\s/u.test(command)) return true;
  return Boolean(ignore?.test(command));
}
