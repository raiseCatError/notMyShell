import {existsSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, join} from 'node:path';
import {promptConfigurationPath} from '../configuration/paths.js';
import type {ShellId} from '../shell/adapters/ShellAdapter.js';

/**
 * Configuration files Ask can find, open and (with a verified plan) add to or
 * update. Each target says where it lives (from NMSh's own path helpers or a
 * small, documented per-app rule), its format, whether creating it is known to
 * be valid, and whether NMSh knows its keys. Knowing where a file lives is not
 * knowing its schema: only NMSh's own config has schema knowledge here.
 */

export type ConfigFormat = 'json' | 'jsonc' | 'toml' | 'keyvalue' | 'shell' | 'text';

export interface ConfigTarget {
  id: string;
  label: string;
  /** Words that name it in a request ("zed", "zed settings", "zshrc"). */
  aliases: string[];
  scope: 'nmsh' | 'app' | 'shell' | 'project' | 'git';
  format: ConfigFormat;
  /** The path NMSh expects, whether or not it exists; undefined when this target does not apply here. */
  path: string | undefined;
  /** Initial content when NMSh knows creating the file there is valid. */
  create?: string;
  /** NMSh ships knowledge of this file's keys (only its own config). */
  schema: boolean;
  /** Words that make this target the subject of a conversation ("terminal" is Zed's or Ghostty's only with their name). */
  domain?: RegExp;
}

export interface ConfigEnvironment {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  shell: ShellId;
  /** Repository root or working directory for project files. */
  projectRoot?: string;
  exists(path: string): boolean;
  list(directory: string): string[];
}

export function systemConfigEnvironment(shell: ShellId, projectRoot?: string): ConfigEnvironment {
  return {home: homedir(), env: process.env, platform: process.platform, shell, ...(projectRoot ? {projectRoot} : {}),
    exists: path => existsSync(path), list: directory => { try { return readdirSync(directory); } catch { return []; } }};
}

const xdg = (environment: ConfigEnvironment) => environment.env.XDG_CONFIG_HOME && isAbsolute(environment.env.XDG_CONFIG_HOME)
  ? environment.env.XDG_CONFIG_HOME : join(environment.home, '.config');

/** The user's own startup file for a shell (never NMSh's private bootstrap). */
export function shellConfigPath(shell: ShellId, environment: Pick<ConfigEnvironment, 'home' | 'env'>): string {
  if (shell === 'fish') return join(environment.env.XDG_CONFIG_HOME && isAbsolute(environment.env.XDG_CONFIG_HOME) ? environment.env.XDG_CONFIG_HOME : join(environment.home, '.config'), 'fish', 'config.fish');
  if (shell === 'bash') return join(environment.home, '.bashrc');
  const zdotdir = environment.env.ZDOTDIR && isAbsolute(environment.env.ZDOTDIR) && !environment.env.ZDOTDIR.includes('nmsh') ? environment.env.ZDOTDIR : environment.home;
  return join(zdotdir, '.zshrc');
}

/** Project files recognized by exact name, only when they exist in the project root (bounded: one directory). */
const PROJECT_FILES: ReadonlyArray<{name: string; format: ConfigFormat; aliases: string[]; domain?: RegExp}> = [
  {name: 'package.json', format: 'json', aliases: ['package', 'package.json', 'npm config', 'node config'], domain: /\b(?:npm|scripts?|dependencies|node)\b/u},
  {name: 'tsconfig.json', format: 'jsonc', aliases: ['tsconfig', 'tsconfig.json', 'typescript config'], domain: /\b(?:typescript|compiler ?options|tsc)\b/u},
  {name: 'jsconfig.json', format: 'jsonc', aliases: ['jsconfig', 'jsconfig.json']},
  {name: 'deno.json', format: 'jsonc', aliases: ['deno config', 'deno.json']},
  {name: 'pyproject.toml', format: 'toml', aliases: ['pyproject', 'pyproject.toml', 'python config'], domain: /\b(?:python|poetry|ruff|black|pytest)\b/u},
  {name: 'Cargo.toml', format: 'toml', aliases: ['cargo', 'cargo.toml', 'rust config'], domain: /\b(?:rust|cargo|crate)\b/u},
  {name: '.prettierrc', format: 'jsonc', aliases: ['prettier config', '.prettierrc']},
  {name: '.prettierrc.json', format: 'json', aliases: ['prettier config', '.prettierrc.json']},
  {name: '.editorconfig', format: 'text', aliases: ['editorconfig', '.editorconfig']},
  {name: '.npmrc', format: 'keyvalue', aliases: ['npmrc', '.npmrc']},
];

/** Every target that applies here (existing or not), in a stable order. */
export function configTargets(environment: ConfigEnvironment): ConfigTarget[] {
  const config = xdg(environment);
  const darwin = environment.platform === 'darwin';
  const targets: ConfigTarget[] = [
    {id: 'nmsh', label: 'NMSh config', aliases: ['nmsh', 'nmsh config', 'notmyshell', 'nmsh settings'], scope: 'nmsh', format: 'json', path: promptConfigurationPath(environment.env), schema: true,
      domain: /\b(?:nmsh|notmyshell|chroma|prompt|transcript|composer)\b/u},
    {id: 'shell', label: `${environment.shell} config`, aliases: [environment.shell, `${environment.shell}rc`, `.${environment.shell}rc`, 'shell', 'shell config', 'rc file', 'dotfile', ...(environment.shell === 'fish' ? ['config.fish'] : [])],
      scope: 'shell', format: 'shell', path: shellConfigPath(environment.shell, environment), schema: false,
      domain: /\b(?:alias(?:es)?|export|path|shell|zsh|bash|fish|rc|env(?:ironment)? var)/u},
    // Zed reads ~/.config/zed on macOS and Linux; settings.json is JSON with comments.
    {id: 'zed', label: 'Zed settings', aliases: ['zed', 'zed settings', 'zed config', 'zed terminal', 'zed terminal config', 'zed terminal settings'], scope: 'app', format: 'jsonc',
      path: join(config, 'zed', 'settings.json'), create: '{\n}\n', schema: false, domain: /\bzed\b/u},
    {id: 'zedKeymap', label: 'Zed keybindings', aliases: ['zed keymap', 'zed keybindings', 'zed keys', 'zed shortcuts'], scope: 'app', format: 'jsonc', path: join(config, 'zed', 'keymap.json'), schema: false, domain: /\bzed\b.*\b(?:key|shortcut)/u},
    {id: 'vscode', label: 'VS Code settings', aliases: ['vscode', 'vs code', 'code settings', 'vscode settings', 'vs code settings'], scope: 'app', format: 'jsonc',
      path: darwin ? join(environment.home, 'Library', 'Application Support', 'Code', 'User', 'settings.json') : join(config, 'Code', 'User', 'settings.json'), schema: false, domain: /\b(?:vs ?code)\b/u},
    {id: 'ghostty', label: 'Ghostty config', aliases: ['ghostty', 'ghostty config', 'ghostty settings'], scope: 'app', format: 'keyvalue',
      path: [join(config, 'ghostty', 'config'), ...(darwin ? [join(environment.home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')] : [])].find(path => environment.exists(path)) ?? join(config, 'ghostty', 'config'),
      schema: false, domain: /\bghostty\b/u},
    {id: 'gitUser', label: 'Git config (user)', aliases: ['git config', 'gitconfig', '.gitconfig', 'global git config', 'user git config'], scope: 'git', format: 'text',
      path: environment.exists(join(environment.home, '.gitconfig')) || !environment.exists(join(config, 'git', 'config')) ? join(environment.home, '.gitconfig') : join(config, 'git', 'config'), schema: false},
  ];
  if (environment.projectRoot) {
    if (environment.exists(join(environment.projectRoot, '.git', 'config'))) {
      targets.push({id: 'gitRepo', label: 'Git config (this repository)', aliases: ['git config', 'repo git config', 'repository git config', 'local git config'], scope: 'git', format: 'text',
        path: join(environment.projectRoot, '.git', 'config'), schema: false});
    }
    const names = new Set(environment.list(environment.projectRoot));
    for (const file of PROJECT_FILES) {
      if (!names.has(file.name)) continue;
      targets.push({id: `project:${file.name}`, label: file.name, aliases: [...file.aliases, 'project config', 'project'], scope: 'project', format: file.format,
        path: join(environment.projectRoot, file.name), schema: false, ...(file.domain ? {domain: file.domain} : {})});
    }
  }
  return targets;
}

export const existing = (targets: readonly ConfigTarget[], environment: ConfigEnvironment) => targets.filter(target => target.path && environment.exists(target.path));

/** Shown paths: ~ for home. */
export function displayConfigPath(path: string, home: string): string {
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
