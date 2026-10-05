import {existsSync, readFileSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, join} from 'node:path';

/**
 * Read-only shell environment diagnostics.
 *
 * Detection reads bounded file contents and checks for well-known paths. It
 * never sources, evaluates or executes shell configuration, never writes, and
 * never installs or disables anything. Every result says what evidence it
 * rests on, so "detected" always has a reason.
 */

export type EnvironmentKind = 'framework' | 'plugin-manager';
export type ShellFamily = 'zsh' | 'fish' | 'bash';

export interface DetectedEnvironment {
  id: string;
  label: string;
  kind: EnvironmentKind;
  shell: ShellFamily;
  evidence: string;
}

export type PluginRelation = 'nmsh-owns-surface' | 'compatible';

export interface DetectedPlugin {
  id: string;
  /** The shell this plugin belongs to; plugins for other shells never describe the active one. */
  shell: ShellFamily;
  label: string;
  evidence: string;
  relation: PluginRelation;
  /** Factual explanation of how it relates to NMSh's own surfaces. */
  note: string;
}

export interface ShellEnvironmentReport {
  environments: DetectedEnvironment[];
  plugins: DetectedPlugin[];
}

const MAX_BYTES = 256 * 1024;

export interface EnvironmentProbe {
  home: string;
  env: NodeJS.ProcessEnv;
  exists(path: string): boolean;
  read(path: string): string | undefined;
}

export function systemProbe(env: NodeJS.ProcessEnv = process.env): EnvironmentProbe {
  const home = env.HOME && isAbsolute(env.HOME) ? env.HOME : homedir();
  return {
    home, env,
    exists: path => existsSync(path),
    read: path => {
      try { return statSync(path).size <= MAX_BYTES ? readFileSync(path, 'utf8') : undefined; } catch { return undefined; }
    },
  };
}

/** Lines that are not comments; detection must not trip on commented-out setup. */
function activeText(text: string | undefined): string {
  return (text ?? '').split('\n').filter(line => !/^\s*#/u.test(line)).join('\n');
}

const tilde = (path: string, home: string) => (path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);

export function detectShellEnvironment(probe: EnvironmentProbe = systemProbe()): ShellEnvironmentReport {
  const {home, env} = probe;
  const zdot = env.ZDOTDIR && isAbsolute(env.ZDOTDIR) ? env.ZDOTDIR : home;
  const xdgConfig = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  const xdgData = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, '.local', 'share');
  const zshrcPath = join(zdot, '.zshrc');
  const zshrc = activeText(probe.read(zshrcPath));
  // Bash reads one of several startup files; each is read as bounded text only, never sourced.
  const bashFiles = ['.bashrc', '.bash_profile', '.bash_login', '.profile'].map(name => ({name, text: activeText(probe.read(join(home, name)))}));
  const bashEvidence = (pattern: RegExp, what: string) => { const hit = bashFiles.find(file => pattern.test(file.text)); return hit ? `~/${hit.name} ${what}` : undefined; };
  const zimrc = activeText(probe.read(join(zdot, '.zimrc')));
  const antidotePlugins = activeText(probe.read(join(zdot, '.zsh_plugins.txt')));
  const sheldon = activeText(probe.read(join(xdgConfig, 'sheldon', 'plugins.toml')));
  const fishPlugins = activeText(probe.read(join(xdgConfig, 'fish', 'fish_plugins')));
  const rc = tilde(zshrcPath, home);
  const environments: DetectedEnvironment[] = [];
  const add = (id: string, label: string, kind: EnvironmentKind, shell: ShellFamily, evidence: string | undefined) => {
    if (evidence) environments.push({id, label, kind, shell, evidence});
  };

  add('oh-my-zsh', 'Oh My Zsh', 'framework', 'zsh',
    /oh-my-zsh\.sh/u.test(zshrc) ? `${rc} sources oh-my-zsh.sh` : undefined);
  add('prezto', 'Prezto', 'framework', 'zsh',
    /zprezto/u.test(zshrc) ? `${rc} loads Prezto` : undefined);
  add('zim', 'Zim', 'framework', 'zsh',
    /zimfw|ZIM_HOME|init\.zsh/u.test(zshrc) && (zimrc || probe.exists(join(zdot, '.zim'))) ? `${tilde(join(zdot, '.zimrc'), home)} and ${rc} reference Zim` : undefined);
  add('antidote', 'Antidote', 'plugin-manager', 'zsh', /\bantidote\b/u.test(zshrc) ? `${rc} calls antidote` : undefined);
  add('zinit', 'Zinit', 'plugin-manager', 'zsh', /\bzinit\b/u.test(zshrc) ? `${rc} calls zinit` : undefined);
  add('sheldon', 'Sheldon', 'plugin-manager', 'zsh', /sheldon\s+source/u.test(zshrc) ? `${rc} runs sheldon source` : undefined);
  add('zplug', 'zplug', 'plugin-manager', 'zsh', /\bzplug\b/u.test(zshrc) ? `${rc} calls zplug` : undefined);
  add('fisher', 'Fisher', 'plugin-manager', 'fish', probe.exists(join(xdgConfig, 'fish', 'functions', 'fisher.fish')) ? 'fisher.fish is in your fish functions' : undefined);
  add('oh-my-fish', 'Oh My Fish', 'framework', 'fish', probe.exists(join(xdgData, 'omf')) ? `${tilde(join(xdgData, 'omf'), home)} exists` : undefined);
  add('oh-my-bash', 'Oh My Bash', 'framework', 'bash', bashEvidence(/oh-my-bash\.sh/u, 'sources oh-my-bash.sh'));
  add('bash-it', 'Bash-it', 'framework', 'bash', bashEvidence(/bash_it\.sh/u, 'sources bash_it.sh'));

  // Oh My Zsh lists plugins as bare names inside plugins=( ... ).
  const omzPlugins = new Set((/^\s*plugins=\(([^)]*)\)/mu.exec(zshrc)?.[1] ?? '').split(/\s+/u).filter(Boolean));
  const sources = [zshrc, zimrc, antidotePlugins, sheldon].join('\n');
  const plugins: DetectedPlugin[] = [];
  const plugin = (id: string, label: string, relation: PluginRelation, note: string, extra = '', shell: ShellFamily = 'zsh') => {
    const pattern = new RegExp(`(?:^|[/\\s"'(])${id.replace(/\./gu, '\\.')}(?:$|[/\\s"').]|\\.plugin)`, 'mu');
    let evidence: string | undefined;
    if (omzPlugins.has(id)) evidence = 'listed in Oh My Zsh plugins=(...)';
    else if (pattern.test(sources)) evidence = 'referenced in your zsh plugin configuration';
    else if (extra && pattern.test(extra)) evidence = 'referenced in your fish plugins';
    if (evidence) plugins.push({id, shell, label, evidence, relation, note});
  };
  plugin('zsh-autosuggestions', 'zsh-autosuggestions', 'nmsh-owns-surface',
    'Draws ghost text through ZLE. NMSh owns its editor and runs zsh without ZLE, so inside NMSh the NMSh suggestions are shown instead; the plugin keeps working in /zsh and ordinary zsh.');
  plugin('zsh-syntax-highlighting', 'zsh-syntax-highlighting', 'nmsh-owns-surface',
    'Highlights the ZLE buffer. Inside NMSh the composer is highlighted by NMSh; the plugin keeps working in /zsh and ordinary zsh.');
  plugin('fast-syntax-highlighting', 'fast-syntax-highlighting', 'nmsh-owns-surface',
    'Highlights the ZLE buffer. Inside NMSh the composer is highlighted by NMSh; the plugin keeps working in /zsh and ordinary zsh.');
  plugin('fzf-tab', 'fzf-tab', 'nmsh-owns-surface',
    'Replaces the ZLE completion menu with fzf. NMSh shows one completion menu of its own and reads completion definitions without fzf-tab\'s UI.');
  plugin('zsh-completions', 'zsh-completions', 'compatible',
    'Adds completion definitions to fpath. NMSh\'s configured completion reads your configured definitions, so these feed the NMSh menu.');
  plugin('z.lua', 'z.lua', 'compatible', 'A directory jumper with its own hooks; NMSh leaves hooks unchanged.');
  plugin('autopair', 'autopair (fish)', 'nmsh-owns-surface', 'Edits the fish command line. NMSh owns the composer, so it has no effect inside NMSh.', fishPlugins, 'fish');
  return {environments, plugins};
}

export const OWNERSHIP_NOTE = 'NMSh provides its editor, completion menu, prompt, transcript and sessions without requiring a plugin manager. '
  + 'Existing shell frameworks and plugin managers keep providing compatible shell-level functionality (aliases, functions, completion definitions, hooks).';

export interface ActiveShell {
  id: ShellFamily;
  /** Resolved executable of the shell backing this session, when known. */
  path?: string;
}

const SHELL_NAMES: Record<ShellFamily, string> = {zsh: 'Zsh', fish: 'Fish', bash: 'Bash'};

/**
 * Status rows: label → value. The first row is the shell actually backing the
 * session (never inferred from $SHELL); framework and plugin rows describe
 * that shell only, and environments found for the other shells are listed
 * separately so they cannot look like they manage this session.
 */
export function shellEnvironmentRows(report: ShellEnvironmentReport, active: ActiveShell): Array<[string, string]> {
  const rows: Array<[string, string]> = [['Shell', active.path ? `${active.id} · ${active.path}` : active.id]];
  const mine = report.environments.filter(item => item.shell === active.id);
  const frameworks = mine.filter(item => item.kind === 'framework');
  const managers = mine.filter(item => item.kind === 'plugin-manager');
  rows.push(['Shell framework', frameworks.length ? frameworks.map(item => `${item.label} (${item.evidence})`).join('; ') : `none · plain ${active.id}`]);
  rows.push(['Plugin manager', managers.length ? managers.map(item => `${item.label} (${item.evidence})`).join('; ') : 'none detected']);
  for (const plugin of report.plugins.filter(item => item.shell === active.id)) rows.push([plugin.label, `detected · ${plugin.relation === 'compatible' ? 'compatible' : 'NMSh owns this surface'}`]);
  const others = (['zsh', 'fish', 'bash'] as const).filter(id => id !== active.id)
    .map(id => ({id, found: report.environments.filter(item => item.shell === id)})).filter(entry => entry.found.length);
  if (others.length) rows.push(['Other shell environments', others.map(entry => `${SHELL_NAMES[entry.id]}: ${entry.found.map(item => item.label).join(', ')}`).join(' · ')]);
  return rows;
}
