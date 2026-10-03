/**
 * Factual identification of known terminal agent CLIs.
 *
 * Identity comes only from the submitted command line's program word (after
 * bounded, well-known wrappers) or the PTY's foreground process name. NMSh
 * never reads an agent's prompt, conversation, response or output to decide
 * anything here, and nothing in this module stores command arguments.
 */

export type AgentId = 'claude' | 'codex';

export interface AgentDescriptor {
  id: AgentId;
  /** Product name as its vendor writes it. */
  name: string;
  /** Short form used in compact status lines ("Worked with Claude for 3m"). */
  short: string;
  /** Executable names that identify this agent. */
  executables: readonly string[];
  /** Package specifiers recognized after a package runner (npx, bunx, pnpm dlx). */
  packages: readonly string[];
  /** Truecolor accent used only when color is allowed; generic chrome otherwise. */
  color: string;
  /** Nerd Font glyph and its Safe-glyph fallback. */
  glyph: string;
  safeGlyph: string;
}

export const KNOWN_AGENTS: readonly AgentDescriptor[] = [
  {id: 'claude', name: 'Claude Code', short: 'Claude', executables: ['claude'], packages: ['@anthropic-ai/claude-code'],
    color: '#d97757', glyph: '✻', safeGlyph: '*'},
  {id: 'codex', name: 'Codex CLI', short: 'Codex', executables: ['codex'], packages: ['@openai/codex'],
    color: '#10a37f', glyph: '◇', safeGlyph: '<>'},
];

const BY_EXECUTABLE = new Map(KNOWN_AGENTS.flatMap(agent => agent.executables.map(name => [name, agent] as const)));
const BY_PACKAGE = new Map(KNOWN_AGENTS.flatMap(agent => agent.packages.map(name => [name, agent] as const)));

export function agentDescriptor(id: AgentId): AgentDescriptor {
  return KNOWN_AGENTS.find(agent => agent.id === id)!;
}

/** Prefix words that run the following command unchanged. Bounded; no flags are interpreted beyond these. */
const TRANSPARENT_WRAPPERS = new Set(['command', 'exec', 'nohup', 'time', 'builtin', 'noglob', 'nice']);
const PACKAGE_RUNNERS = new Set(['npx', 'bunx', 'pnpx']);

const baseName = (word: string) => word.slice(word.lastIndexOf('/') + 1);
/** Strip a version suffix: `@openai/codex@latest` → `@openai/codex`. */
const packageName = (word: string) => word.replace(/^(@[^/@\s]+\/[^@\s]+|[^@\s]+)@.*$/u, '$1');

/**
 * The known agent a command line starts, if any. Only the program position is
 * considered: `git commit -m "claude"` and `echo codex` are not agents.
 */
export function detectAgentCommand(command: string): AgentDescriptor | undefined {
  // Only the first simple command: a pipeline or list after it is not the program identity.
  const head = command.trim().split(/\s*(?:\|\|?|&&|;|\n)\s*/u, 1)[0] ?? '';
  const words = head.split(/\s+/u).filter(Boolean).slice(0, 12);
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index]!)) index += 1;
  while (index < words.length && TRANSPARENT_WRAPPERS.has(words[index]!)) {
    index += 1;
    while (index < words.length && words[index]!.startsWith('-')) index += 1;
  }
  const program = words[index];
  if (!program) return undefined;
  const name = baseName(program);
  const direct = BY_EXECUTABLE.get(name);
  if (direct) return direct;
  let next = index + 1;
  if (name === 'pnpm' && words[next] === 'dlx') next += 1;
  else if (name === 'npm' && (words[next] === 'exec' || words[next] === 'x')) next += 1;
  else if (!PACKAGE_RUNNERS.has(name)) return undefined;
  while (next < words.length && words[next] !== '--' && words[next]!.startsWith('-')) next += 1;
  const target = words[next];
  if (!target) return undefined;
  if (target === '--') return undefined;
  return BY_PACKAGE.get(packageName(target)) ?? BY_EXECUTABLE.get(target);
}

/** The known agent a foreground process name identifies (e.g. from the PTY), if any. */
export function detectAgentProcess(process: string | undefined): AgentDescriptor | undefined {
  return process ? BY_EXECUTABLE.get(baseName(process)) : undefined;
}
