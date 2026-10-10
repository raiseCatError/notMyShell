import {readFileSync, realpathSync, statSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Passive discovery of simple existing Claude launch namespaces, offered for explicit import.
 *
 * Only an inert alias of exactly this form is recognized, read as text from the person's shell files:
 *   alias claude-account2='CLAUDE_CONFIG_DIR="$HOME/.claude-account2" /absolute/path/claude'
 * Nothing is sourced, evaluated or executed; every other line, and any line with shell syntax beyond
 * that form (expansions other than a leading $HOME or ~, quotes inside values, operators, extra
 * words), is ignored. Credentials and Claude's own files are never read: only the directory's
 * existence is checked. The executable must be the same Claude NMSh would run, so the profile means
 * exactly what the alias did. Nothing is persisted until the person chooses Import.
 */
export interface DiscoveredProfile {
  /** Profile key, from the alias name (`claude-account2` → `account2`). */
  name: string;
  /** Human label (`Claude account 2`). */
  label: string;
  configDir: string;
  alias: string;
}

const ALIAS = /^\s*alias\s+(claude[-_]([A-Za-z0-9][\w.-]{0,38}))=(['"])CLAUDE_CONFIG_DIR=(["']?)(\$HOME\/|\$\{HOME\}\/|~\/|\/)([A-Za-z0-9._/-]{1,200})\4\s+(\/[A-Za-z0-9._/-]{1,300}\/claude)\3\s*(?:#.*)?$/u;
const SHELL_FILES = ['.zshrc', '.zshenv', '.zprofile', '.bashrc', '.bash_profile', '.bash_aliases', '.aliases'];
const MAX_FILE_BYTES = 512 * 1024;

/** `account2` → `Claude account 2`; `work-team` → `Claude work team`. */
export function profileLabelFromAlias(name: string): string {
  return `Claude ${name.replace(/[-_.]+/gu, ' ').replace(/([A-Za-z])(\d)/gu, '$1 $2').trim()}`;
}

/** Recognize the narrow alias form in one file's text; `resolve` maps the alias's executable to the real path. */
export function parseClaudeAliases(text: string, home: string): Array<DiscoveredProfile & {executable: string}> {
  const found: Array<DiscoveredProfile & {executable: string}> = [];
  for (const line of text.split('\n')) {
    if (line.length > 1000 || !line.includes('CLAUDE_CONFIG_DIR')) continue;
    const match = ALIAS.exec(line);
    if (!match) continue;
    const [, alias, name, , , root, rest, executable] = match as unknown as [string, string, string, string, string, string, string, string];
    if (rest.split('/').some(part => part === '..')) continue;
    const configDir = root === '/' ? `/${rest}` : join(home, rest);
    found.push({alias, name, label: profileLabelFromAlias(name), configDir, executable});
  }
  return found;
}

export interface DiscoveryEnvironment {
  home: string;
  /** The Claude executable NMSh would run (already resolved on PATH). */
  claude?: string;
  readFile?(path: string): string | undefined;
  isDirectory?(path: string): boolean;
  realpath?(path: string): string | undefined;
}

export function discoverClaudeProfiles(env: DiscoveryEnvironment, existing: ReadonlySet<string> = new Set()): DiscoveredProfile[] {
  const read = env.readFile ?? (path => { try { return statSync(path).size <= MAX_FILE_BYTES ? readFileSync(path, 'utf8') : undefined; } catch { return undefined; } });
  const isDirectory = env.isDirectory ?? (path => { try { return statSync(path).isDirectory(); } catch { return false; } });
  const realpath = env.realpath ?? (path => { try { return realpathSync(path); } catch { return undefined; } });
  const claude = env.claude ? realpath(env.claude) : undefined;
  if (!claude) return [];
  const profiles: DiscoveredProfile[] = [];
  for (const file of SHELL_FILES) {
    const text = read(join(env.home, file));
    if (!text) continue;
    for (const item of parseClaudeAliases(text, env.home)) {
      if (existing.has(item.name) || profiles.some(profile => profile.name === item.name || profile.configDir === item.configDir)) continue;
      if (realpath(item.executable) !== claude || !isDirectory(item.configDir)) continue;
      profiles.push({name: item.name, label: item.label, configDir: item.configDir, alias: item.alias});
    }
  }
  return profiles.slice(0, 8);
}
