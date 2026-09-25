import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {ToolchainId} from '../shell/ShellContext.js';

/**
 * Show-on-command: modules that appear while the command being typed makes
 * them relevant. Everything here is a deterministic rule over the editor
 * text; nothing typed is ever executed, completed, or inferred.
 */
export type CommandContextId = 'kubeContext' | 'dockerContext';

export const COMMAND_CONTEXT_TRIGGERS: Record<CommandContextId, readonly string[]> = {
  kubeContext: ['kubectl', 'helm', 'helmfile', 'k9s', 'kubectx', 'kubens', 'kustomize', 'stern', 'flux', 'skaffold', 'tilt', 'oc'],
  dockerContext: ['docker', 'docker-compose', 'lazydocker'],
};

/** Toolchain modules set to "on command" show only the toolchains the command is about. */
export const TOOLCHAIN_TRIGGERS: Record<ToolchainId, readonly string[]> = {
  node: ['node', 'npm', 'npx', 'pnpm', 'yarn', 'corepack', 'tsx', 'tsc'],
  go: ['go', 'gofmt'],
  python: ['python', 'python3', 'pip', 'pip3', 'pipx', 'uv', 'uvx', 'poetry', 'pytest', 'pipenv'],
  docker: COMMAND_CONTEXT_TRIGGERS.dockerContext,
};

/** Precommand words that run the following word as the command. */
const PRECOMMANDS = new Set(['sudo', 'doas', 'env', 'time', 'command', 'builtin', 'noglob', 'exec', 'nice', 'nohup', '-', 'caffeinate']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/**
 * The command word of every simple command in the buffer: the first word
 * after `;`, `&&`, `||`, `|`, `&`, `(` or a newline, skipping assignments,
 * precommands and their options. Quoted words are taken literally.
 */
export function commandWords(text: string): string[] {
  const words: string[] = [];
  for (const segment of text.split(/\|\||&&|[;|&\n(){}]/u)) {
    const tokens = segment.trim().split(/\s+/u).filter(Boolean);
    let index = 0;
    let precommand = false;
    while (index < tokens.length) {
      const token = tokens[index]!;
      if (ASSIGNMENT.test(token) || (precommand && token.startsWith('-'))) { index += 1; continue; }
      if (PRECOMMANDS.has(token)) { precommand = true; index += 1; continue; }
      break;
    }
    const word = tokens[index]?.replace(/^['"]|['"]$/gu, '').replace(/^.*\//u, '');
    if (word) words.push(word);
  }
  return words;
}

export function matchesCommand(triggers: readonly string[], words: readonly string[] | undefined): boolean {
  return Boolean(words?.some(word => triggers.includes(word)));
}

/** Current kubectl context from the first kubeconfig that names one. Reads files only. */
export async function readKubeContext(env: NodeJS.ProcessEnv = process.env, home = homedir()): Promise<string | undefined> {
  const files = env.KUBECONFIG ? env.KUBECONFIG.split(':').filter(Boolean) : [join(home, '.kube', 'config')];
  for (const file of files) {
    try {
      const match = /^current-context:[ \t]*(['"]?)(.*?)\1[ \t]*$/mu.exec(await readFile(file, 'utf8'));
      if (match?.[2]) return match[2];
    } catch {
      // Missing or unreadable kubeconfig files contribute nothing.
    }
  }
  return undefined;
}

/** Current Docker context: DOCKER_CONTEXT, then DOCKER_HOST, then the CLI config, else `default`. */
export async function readDockerContext(env: NodeJS.ProcessEnv = process.env, home = homedir()): Promise<string> {
  if (env.DOCKER_CONTEXT) return env.DOCKER_CONTEXT;
  if (env.DOCKER_HOST) return env.DOCKER_HOST;
  try {
    const config = JSON.parse(await readFile(join(env.DOCKER_CONFIG ?? join(home, '.docker'), 'config.json'), 'utf8')) as unknown;
    const current = typeof config === 'object' && config !== null ? (config as {currentContext?: unknown}).currentContext : undefined;
    if (typeof current === 'string' && current) return current;
  } catch {
    // No Docker CLI config means the default context.
  }
  return 'default';
}

/**
 * Non-blocking lookups: `get` answers from cache immediately and refreshes
 * stale values in the background, calling `onUpdate` when one changes.
 */
export class CommandContextCache {
  private readonly values = new Map<CommandContextId, {value: string | undefined; at: number}>();
  private readonly inFlight = new Set<CommandContextId>();

  constructor(
    private readonly onUpdate: () => void,
    private readonly readers: Record<CommandContextId, () => Promise<string | undefined>> = {
      kubeContext: () => readKubeContext(),
      dockerContext: () => readDockerContext(),
    },
    private readonly maxAgeMs = 5000,
    private readonly now: () => number = Date.now,
  ) {}

  get(id: CommandContextId): string | undefined {
    const cached = this.values.get(id);
    if ((!cached || this.now() - cached.at > this.maxAgeMs) && !this.inFlight.has(id)) void this.refresh(id);
    return cached?.value;
  }

  private async refresh(id: CommandContextId): Promise<void> {
    this.inFlight.add(id);
    let value: string | undefined;
    try {
      value = await this.readers[id]();
    } catch {
      value = undefined;
    } finally {
      this.inFlight.delete(id);
    }
    const previous = this.values.get(id);
    this.values.set(id, {value, at: this.now()});
    if (previous?.value !== value) this.onUpdate();
  }
}
