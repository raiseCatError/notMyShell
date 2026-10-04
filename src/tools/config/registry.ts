import {homedir} from 'node:os';
import {join} from 'node:path';
import {resolveCommand} from '../../providers/providers.js';

/**
 * First-party registry of reviewed tool configuration adapters. It is not a
 * plugin system: only entries here can ever be configured by NMSh, and an
 * entry's `ownership` says exactly how (a managed fragment plus one reviewed
 * include, the tool's own config CLI, Theme Bridge only, or read-only).
 * Detection never grants write authority. /tools, /configure, /tmux, Ask and
 * /dotfiles all read this one table.
 */

/** structured: TOML/JSON/YAML data · command: a command-style config (tmux) · executable: code (Lua, Vimscript, shell). */
export type ConfigClass = 'structured' | 'command' | 'executable';
export type Ownership = 'managed-fragment' | 'native-cli' | 'theme-bridge' | 'read-only';

export interface ToolConfigEntry {
  id: string;
  label: string;
  executable: string;
  configClass: ConfigClass;
  ownership: Ownership;
  /** Config files this tool reads (for discovery and dotfiles mapping; never all writable). */
  locations: (env: NodeJS.ProcessEnv, home: string) => string[];
  /** When a supported change takes effect. */
  takesEffect: string;
  /** What NMSh can configure, in plain words. */
  summary: string;
  /** Dotfiles relative paths (inside a repo or Stow package) this adapter recognizes. */
  dotfiles: RegExp;
  /** Whether /configure opens an editor for it. */
  configurable: boolean;
}

const xdg = (env: NodeJS.ProcessEnv, home: string) => env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith('/') ? env.XDG_CONFIG_HOME : join(home, '.config');

export const TOOL_CONFIG_REGISTRY: readonly ToolConfigEntry[] = [
  {id: 'tmux', label: 'tmux', executable: 'tmux', configClass: 'command', ownership: 'managed-fragment', configurable: true,
    locations: (env, home) => [join(home, '.tmux.conf'), join(xdg(env, home), 'tmux', 'tmux.conf')],
    takesEffect: 'New tmux servers through the include; a running server on Reload',
    summary: 'Settings, prefix and key bindings, Status Studio, new panes start NMSh, Theme Bridge colors',
    dotfiles: /(?:^|\/)(?:\.tmux\.conf|tmux\/tmux\.conf|\.config\/tmux\/tmux\.conf)$/u},
  {id: 'starship', label: 'Starship', executable: 'starship', configClass: 'structured', ownership: 'native-cli', configurable: true,
    locations: (env, home) => [env.STARSHIP_CONFIG ?? join(xdg(env, home), 'starship.toml')],
    takesEffect: 'The next prompt', summary: 'Module visibility through Starship\'s own config CLI, with a backup',
    dotfiles: /(?:^|\/)(?:starship\.toml|\.config\/starship\.toml)$/u},
  {id: 'helix', label: 'Helix', executable: 'hx', configClass: 'structured', ownership: 'theme-bridge', configurable: false,
    locations: (env, home) => [join(xdg(env, home), 'helix', 'config.toml')],
    takesEffect: 'New Helix processes', summary: 'The generated NMSh theme and its one reviewed activation (Theme Bridge)',
    dotfiles: /(?:^|\/)(?:helix\/config\.toml|\.config\/helix\/config\.toml)$/u},
  {id: 'bat', label: 'bat', executable: 'bat', configClass: 'structured', ownership: 'theme-bridge', configurable: false,
    locations: (env, home) => [join(env.BAT_CONFIG_DIR ?? join(xdg(env, home), 'bat'), 'config')],
    takesEffect: 'After a reviewed cache build', summary: 'A generated custom theme and BAT_THEME in NMSh shells (Theme Bridge)',
    dotfiles: /(?:^|\/)(?:bat\/config|\.config\/bat\/config)$/u},
  {id: 'neovim', label: 'Neovim', executable: 'nvim', configClass: 'executable', ownership: 'theme-bridge', configurable: false,
    locations: (env, home) => [join(xdg(env, home), 'nvim', 'init.lua'), join(xdg(env, home), 'nvim', 'init.vim')],
    takesEffect: 'New Neovim processes', summary: 'A generated colorscheme and one reviewed include; Lua config is never rewritten',
    dotfiles: /(?:^|\/)(?:nvim\/init\.(?:lua|vim)|\.config\/nvim\/init\.(?:lua|vim))$/u},
  {id: 'vim', label: 'Vim', executable: 'vim', configClass: 'executable', ownership: 'theme-bridge', configurable: false,
    locations: (_env, home) => [join(home, '.vimrc'), join(home, '.vim', 'vimrc')],
    takesEffect: 'New Vim processes', summary: 'A generated colorscheme and one reviewed include; Vimscript is never rewritten',
    dotfiles: /(?:^|\/)(?:\.vimrc|\.vim\/vimrc|vimrc)$/u},
  {id: 'zsh', label: 'zsh', executable: 'zsh', configClass: 'executable', ownership: 'read-only', configurable: false,
    locations: (_env, home) => [join(home, '.zshrc')], takesEffect: '—', summary: 'Inspect only; shell code is never sourced or rewritten (NMSh owns its composer)',
    dotfiles: /(?:^|\/)(?:\.zshrc|\.zshenv|\.zprofile|zshrc)$/u},
  {id: 'bash', label: 'Bash', executable: 'bash', configClass: 'executable', ownership: 'read-only', configurable: false,
    locations: (_env, home) => [join(home, '.bashrc')], takesEffect: '—', summary: 'Inspect only; shell code is never sourced or rewritten',
    dotfiles: /(?:^|\/)(?:\.bashrc|\.bash_profile|bashrc)$/u},
  {id: 'fish', label: 'Fish', executable: 'fish', configClass: 'executable', ownership: 'read-only', configurable: false,
    locations: (env, home) => [join(xdg(env, home), 'fish', 'config.fish')], takesEffect: '—', summary: 'Inspect only; shell code is never sourced or rewritten',
    dotfiles: /(?:^|\/)(?:fish\/config\.fish|\.config\/fish\/config\.fish)$/u},
];

export function toolConfigEntry(id: string): ToolConfigEntry | undefined {
  return TOOL_CONFIG_REGISTRY.find(entry => entry.id === id || entry.executable === id);
}

export const OWNERSHIP_LABELS: Record<Ownership, string> = {
  'managed-fragment': 'NMSh-managed file + one reviewed include', 'native-cli': 'the tool\'s own config CLI, with backup',
  'theme-bridge': 'Theme Bridge (generated theme + reviewed activation)', 'read-only': 'inspect only',
};

/** Installed facts for the registry (PATH lookups only; nothing is run). */
export function registryFacts(env: NodeJS.ProcessEnv = process.env): Array<ToolConfigEntry & {installed: boolean}> {
  return TOOL_CONFIG_REGISTRY.map(entry => ({...entry, installed: Boolean(resolveCommand(entry.executable, env.PATH ?? ''))}));
}

export const configLocations = (entry: ToolConfigEntry, env: NodeJS.ProcessEnv = process.env) => entry.locations(env, env.HOME || homedir());
