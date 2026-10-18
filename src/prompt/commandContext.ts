import {homedir} from 'node:os';
import type {ToolchainId} from '../shell/ShellContext.js';
import {docker, kubernetes} from '../context/capabilities/infrastructure.js';
import {frontendEnvironment} from '../context/shellEnvironment.js';

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

/** One-off reads through the Context Engine capabilities (the engine itself caches and schedules these for the prompt). */
function capabilityContext(env: NodeJS.ProcessEnv, home: string, fields: string[]) {
  return {cwd: home, home, session: 'standalone', env: frontendEnvironment(env), fields: new Set(fields), signal: new AbortController().signal, now: Date.now()};
}

/** Current kubectl context from the first kubeconfig that names one. Reads files only; exec credential plugins are never run. */
export async function readKubeContext(env: NodeJS.ProcessEnv = process.env, home = homedir()): Promise<string | undefined> {
  return (await kubernetes.resolve(capabilityContext(env, home, ['context'])))?.value.context;
}

/** Current Docker context: DOCKER_CONTEXT, then DOCKER_HOST, then the CLI config, else `default`. */
export async function readDockerContext(env: NodeJS.ProcessEnv = process.env, home = homedir()): Promise<string> {
  return (await docker.resolve(capabilityContext(env, home, ['context'])))?.value.context ?? 'default';
}
