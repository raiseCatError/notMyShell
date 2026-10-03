import {existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter, dirname, isAbsolute, join, resolve} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {defaultRuntimeDir} from '../session/runtimeDir.js';

/**
 * NMSh self-uninstall: preview first, remove only what is provably NMSh's.
 *
 * Provable: `nmsh` launcher symlinks (as `npm link` creates) and npm global
 * package links whose target resolves into this NMSh installation. Never
 * removed automatically: the source checkout itself (you cloned it), shell
 * config, terminal config, or anything a symlink does not prove is ours.
 * NMSh's local data (settings, transcripts, history deletions, agent stats,
 * install records) is kept unless separately requested.
 */

export interface UninstallOptions {
  /** NMSh package root (the directory containing bin/nmsh). */
  root: string;
  env: NodeJS.ProcessEnv;
  /** npm global prefix, when known (npm config get prefix). */
  npmPrefix?: string;
}

export interface UninstallPlan {
  root: string;
  layout: 'git-checkout' | 'package' | 'unknown';
  /** Symlinks that resolve into `root`; removed on uninstall. */
  links: string[];
  /** Kept unless --delete-data: path and what it holds. */
  data: Array<{path: string; description: string}>;
  /** Things NMSh cannot prove it owns, with what to do by hand. */
  manual: string[];
  /** Live sessions block uninstall: their shells would lose their frontend program. */
  runtimeDir: string;
}

const GHOSTTY_KEYBIND_LINES = ['keybind = cmd+a=text:\\x1b[97;9u', 'keybind = cmd+up=text:\\x1b[1;9A', 'keybind = cmd+down=text:\\x1b[1;9B',
  'keybind = cmd+shift+up=text:\\x1b[1;10A', 'keybind = cmd+shift+down=text:\\x1b[1;10B', 'keybind = alt+backspace=text:\\x1b[127;3u'];

function realOrUndefined(path: string): string | undefined {
  try { return realpathSync(path); } catch { return undefined; }
}

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`);
}

/** Symlinks named `nmsh` on PATH (and in the npm prefix) whose target lives inside root. */
export function findOwnedLinks(root: string, env: NodeJS.ProcessEnv, npmPrefix?: string): string[] {
  const realRoot = realOrUndefined(root) ?? resolve(root);
  const candidates = new Set<string>();
  for (const directory of (env.PATH ?? '').split(delimiter)) if (directory && isAbsolute(directory)) candidates.add(join(directory, 'nmsh'));
  if (npmPrefix && isAbsolute(npmPrefix)) {
    candidates.add(join(npmPrefix, 'bin', 'nmsh'));
    candidates.add(join(npmPrefix, 'lib', 'node_modules', 'nmsh'));
    candidates.add(join(npmPrefix, 'node_modules', 'nmsh'));
  }
  const owned: string[] = [];
  for (const path of candidates) {
    let stat;
    try { stat = lstatSync(path); } catch { continue; }
    if (!stat.isSymbolicLink()) continue; // A real file could be anything; never removed.
    const target = realOrUndefined(path);
    if (target && inside(target, realRoot)) owned.push(path);
  }
  return owned.sort();
}

export function planUninstall(options: UninstallOptions): UninstallPlan {
  const {root, env} = options;
  const layout = existsSync(join(root, '.git')) ? 'git-checkout' : existsSync(join(root, 'package.json')) ? 'package' : 'unknown';
  const config = nmshConfigDirectory(env);
  const data: UninstallPlan['data'] = [];
  if (existsSync(config)) data.push({path: config, description: 'settings, transcripts, presets, history deletions, agent stats, install records'});
  const manual: string[] = [];
  if (layout === 'git-checkout') manual.push(`The NMSh source checkout stays at ${root}; delete it yourself when you no longer want it.`);
  else if (layout === 'package') manual.push(`NMSh files at ${root} belong to the package manager that installed them; remove NMSh with it (for example npm uninstall -g nmsh).`);
  const home = [env.HOME].find(value => value && isAbsolute(value)) ?? homedir();
  const ghostty = [join(env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config'), 'ghostty', 'config'),
    join(env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config'), 'ghostty', 'config.ghostty'),
    join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config'),
    join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config.ghostty')];
  for (const path of ghostty) {
    let text = '';
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    const present = GHOSTTY_KEYBIND_LINES.filter(line => text.split('\n').includes(line));
    if (present.length) manual.push(`${path} contains ${present.length} keybind line(s) that /keyboard can add (for example \`${present[0]}\`). They have no NMSh marker, so they are left for you to remove if you added them through NMSh.`);
  }
  return {root, layout, links: findOwnedLinks(root, env, options.npmPrefix), data, manual, runtimeDir: defaultRuntimeDir(env)};
}

/** Live session sockets mean shells still depend on this installation. */
export function liveServiceSockets(runtimeDir: string): string[] {
  try { return readdirSync(runtimeDir).filter(name => /^nmshd(?:-v\d+)?\.sock$/u.test(name)).map(name => join(runtimeDir, name)); } catch { return []; }
}

export function formatUninstallPlan(plan: UninstallPlan, deleteData: boolean): string {
  const lines = [`NMSh installation: ${plan.root} (${plan.layout === 'git-checkout' ? 'source checkout' : plan.layout})`, ''];
  lines.push(plan.links.length ? 'Will remove (symlinks into this installation):' : 'No launcher symlinks into this installation were found.');
  for (const link of plan.links) lines.push(`  - ${link}`);
  if (plan.data.length) {
    lines.push('', deleteData ? 'Will also delete NMSh local data (--delete-data):' : 'Kept (your NMSh data; add --delete-data to remove):');
    for (const item of plan.data) lines.push(`  ${deleteData ? '-' : '='} ${item.path}  (${item.description})`);
  }
  lines.push('', 'Not touched: your shell config (.zshrc, .bashrc, config.fish), shell history, and installed tools.');
  if (plan.manual.length) { lines.push('', 'Manual cleanup, if you want it:'); for (const item of plan.manual) lines.push(`  * ${item}`); }
  return `${lines.join('\n')}\n`;
}

export interface UninstallResult { removed: string[]; failed: Array<{path: string; error: string}> }

/**
 * Apply a reviewed plan. Each link is re-verified just before removal, so a
 * path that changed since the preview is skipped rather than removed.
 */
export function applyUninstall(plan: UninstallPlan, options: {deleteData: boolean; env: NodeJS.ProcessEnv}): UninstallResult {
  const result: UninstallResult = {removed: [], failed: []};
  const realRoot = realOrUndefined(plan.root) ?? resolve(plan.root);
  for (const link of plan.links) {
    try {
      const target = realOrUndefined(link);
      if (!lstatSync(link).isSymbolicLink() || !target || !inside(target, realRoot)) throw new Error('changed since the preview; skipped');
      unlinkSync(link);
      result.removed.push(link);
    } catch (error) { result.failed.push({path: link, error: error instanceof Error ? error.message : String(error)}); }
  }
  if (options.deleteData) {
    for (const item of plan.data) {
      // Only ever the NMSh config directory computed for this environment.
      if (item.path !== nmshConfigDirectory(options.env) || dirname(item.path) === item.path) { result.failed.push({path: item.path, error: 'unexpected path; skipped'}); continue; }
      try { rmSync(item.path, {recursive: true, force: true}); result.removed.push(item.path); }
      catch (error) { result.failed.push({path: item.path, error: error instanceof Error ? error.message : String(error)}); }
    }
  }
  return result;
}

export const GOODBYE = 'NMSh is uninstalled. Your shell is exactly as you left it.';
