import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat, readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {displayText} from '../transcript/projection.js';
import type {ModComponents, ModEntry} from './model.js';

/**
 * Claude Code plugins and mods through Claude's own supported surface: `claude plugin list --json` for what is
 * installed and enabled, static reads of each plugin's manifest files for what it contains, and `claude plugin
 * enable|disable --scope … --json` for changes. Plugin code is never imported or run by discovery: manifests are
 * read as bounded JSON, and component folders are only counted.
 */

const run = promisify(execFile);
const text = (value: unknown, limit = 256) => typeof value === 'string' ? displayText(value).replace(/\n/gu, ' ').slice(0, limit) : '';
const MAX_JSON = 256 * 1024;
const PLUGIN_ID = /^[\w.-]{1,96}@[\w.-]{1,96}$/u;

/** One row of `claude plugin list --json` (Claude Code 2.1.29x), as far as NMSh reads it. */
export interface ClaudeListing {
  id: string;
  version?: string;
  scope: 'user' | 'project' | 'local' | string;
  enabled?: boolean;
  installPath?: string;
  projectPath?: string;
  hasUserConfig?: boolean;
  readFromFolder?: string;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_JSON) return undefined;
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

async function count(path: string, match: (name: string, isDir: boolean) => boolean): Promise<number> {
  try { return (await readdir(path, {withFileTypes: true})).slice(0, 512).filter(entry => match(entry.name, entry.isDirectory())).length; } catch { return 0; }
}

/** What a plugin contains, from its manifest files only (the documented layout); nothing is executed. */
export async function readComponents(installPath: string): Promise<{components: ModComponents; name?: string; description?: string; dependencies: string[]}> {
  const manifest = await readJson(join(installPath, '.claude-plugin', 'plugin.json')) ?? {};
  const hooksFile = await readJson(join(installPath, 'hooks', 'hooks.json')) ?? {};
  // A mod declares hook modules; a settings-style hook file maps events to commands.
  const modules = Array.isArray(hooksFile.modules) ? hooksFile.modules.length : 0;
  const events = hooksFile.hooks && typeof hooksFile.hooks === 'object' ? Object.keys(hooksFile.hooks as object).length : 0;
  const mcp = Boolean(await readJson(join(installPath, '.mcp.json'))) || Boolean(manifest.mcpServers);
  const lsp = Boolean(await readJson(join(installPath, '.lsp.json'))) || Boolean(manifest.lspServers);
  const dependencies = Array.isArray(manifest.dependencies) ? manifest.dependencies.flatMap(item => typeof item === 'string' ? [text(item, 120)] : item && typeof item === 'object' && typeof (item as {name?: unknown}).name === 'string' ? [text((item as {name: string}).name, 120)] : []).slice(0, 16) : [];
  return {
    components: {mod: modules > 0, hookEvents: events, skills: await count(join(installPath, 'skills'), (_name, isDir) => isDir), agents: await count(join(installPath, 'agents'), name => name.endsWith('.md')),
      commands: await count(join(installPath, 'commands'), name => name.endsWith('.md')), mcp, lsp},
    ...(text(manifest.name) ? {name: text(manifest.name, 96)} : {}),
    ...(text(manifest.description) ? {description: text(manifest.description, 600)} : {}),
    dependencies,
  };
}

/** The plugin's type in words: a mod is code inside Claude Code; anything else is a plugin of declarative parts and scripts. */
export function nativeType(components: ModComponents | undefined): 'Mod' | 'Plugin' {
  return components?.mod ? 'Mod' : 'Plugin';
}

/**
 * What a plugin does in an NMSh-managed Claude session (`claude --print` with stream-json), per Claude's documented
 * behavior: a mod's hooks run, but nothing it draws appears; skills, agents, commands, settings hooks, MCP and LSP
 * servers load as in any session.
 */
export function managedRuntime(components: ModComponents | undefined, drawsOnly?: boolean): string {
  if (!components) return 'Loads in managed sessions like any Claude session';
  const parts = [components.skills ? `${components.skills} skill${components.skills === 1 ? '' : 's'}` : '', components.agents ? `${components.agents} agent${components.agents === 1 ? '' : 's'}` : '',
    components.commands ? `${components.commands} command${components.commands === 1 ? '' : 's'}` : '', components.hookEvents ? 'settings hooks' : '', components.mcp ? 'MCP server' : '', components.lsp ? 'LSP server' : ''].filter(Boolean);
  if (components.mod) {
    const mod = drawsOnly ? 'Mod draws only in Claude\'s own interface: nothing of it appears in NMSh-managed sessions' : 'Mod hooks run in NMSh-managed sessions; panes, bands and restyled rows it draws do not appear there';
    return parts.length ? `${mod}; ${parts.join(', ')} load` : mod;
  }
  return parts.length ? `${parts.join(', ')} load in NMSh-managed sessions` : 'Loads in managed sessions';
}

/** Project-level enabledPlugins overrides for this directory (local wins over project), read passively. */
export async function projectOverrides(cwd: string): Promise<Map<string, {enabled: boolean; file: string}>> {
  const overrides = new Map<string, {enabled: boolean; file: string}>();
  for (const file of ['settings.json', 'settings.local.json']) {
    const value = await readJson(join(cwd, '.claude', file));
    const plugins = value?.enabledPlugins;
    if (!plugins || typeof plugins !== 'object') continue;
    for (const [id, enabled] of Object.entries(plugins as Record<string, unknown>).slice(0, 256)) if (typeof enabled === 'boolean' && PLUGIN_ID.test(id)) overrides.set(id, {enabled, file: `.claude/${file}`});
  }
  return overrides;
}

/** Inventory rows from Claude's own listing, with each plugin's components and the effective state for `cwd`. */
export async function claudePluginEntries(listing: unknown, cwd: string, profile?: {name: string; configDir?: string}): Promise<ModEntry[]> {
  if (!Array.isArray(listing)) throw new Error('Claude plugin listing has an unsupported shape');
  const overrides = await projectOverrides(cwd);
  const rows = listing.slice(0, 256).filter((raw): raw is ClaudeListing => Boolean(raw) && typeof raw === 'object' && typeof (raw as ClaudeListing).id === 'string' && PLUGIN_ID.test((raw as ClaudeListing).id));
  // Project and local installations belong to one directory: only this one's are shown.
  const here = rows.filter(raw => raw.scope === 'user' || ((raw.scope === 'project' || raw.scope === 'local') && raw.projectPath === cwd));
  const scopesById = new Map<string, ClaudeListing[]>();
  for (const raw of here) scopesById.set(raw.id, [...(scopesById.get(raw.id) ?? []), raw]);
  const entries: ModEntry[] = [];
  for (const raw of here) {
    const installPath = typeof raw.installPath === 'string' ? raw.installPath : undefined;
    const read = installPath ? await readComponents(installPath) : undefined;
    const [name, marketplace] = raw.id.split('@') as [string, string];
    const scope = raw.scope === 'user' ? 'global' as const : 'project' as const;
    const override = raw.scope === 'user' ? overrides.get(raw.id) : undefined;
    const enabled = override ? override.enabled : raw.enabled;
    const others = (scopesById.get(raw.id) ?? []).filter(item => item !== raw);
    const notes = [
      ...(override && override.enabled !== raw.enabled ? [`${override.enabled ? 'Enabled' : 'Disabled'} for this project by ${override.file} (user setting: ${raw.enabled ? 'enabled' : 'disabled'})`] : []),
      ...others.map(item => `Also installed at ${item.scope} scope${item.version && item.version !== raw.version ? ` (version ${text(item.version, 24)})` : ''}`),
      ...(read?.dependencies.length ? [`Depends on ${read.dependencies.join(', ')}`] : []),
      ...(raw.hasUserConfig ? ['Has options; configure them with claude plugin configure'] : []),
    ];
    const key = createHash('sha256').update(JSON.stringify([profile?.name, raw.id, raw.scope, raw.projectPath])).digest('hex').slice(0, 24);
    entries.push({key: `claude:${key}`, id: raw.id, name: read?.name ?? text(name, 96), kind: 'Provider-native', provider: 'claude',
      ...(profile ? {profileId: profile.name} : {}),
      ...(read?.description ? {description: read.description} : {}),
      source: `${text(marketplace, 96)} marketplace${raw.readFromFolder ? ' (local folder)' : ''}`, ...(raw.version ? {version: text(raw.version, 24)} : {}),
      scope, ...(installPath ? {reference: text(installPath, 512)} : {}), installedBy: 'provider',
      enabled: enabled === true ? 'yes' : enabled === false ? 'no' : 'unknown', managed: false, executesInside: 'Claude Code', sandbox: 'No',
      permissions: [], applicability: ['claude'], evidence: override ? `claude plugin list --json; overridden by ${override.file}` : 'claude plugin list --json',
      nativeType: nativeType(read?.components), ...(read ? {components: read.components} : {}), runtime: managedRuntime(read?.components), notes,
      claude: {pluginId: raw.id, scope: raw.scope === 'user' || raw.scope === 'project' || raw.scope === 'local' ? raw.scope : 'user', ...(raw.projectPath ? {projectPath: raw.projectPath} : {}), ...(profile?.configDir ? {configDir: profile.configDir} : {})},
      toggle: override ? {supported: false, reason: `This project's ${override.file} decides it here; NMSh changes only the scope a plugin is installed at`} : {supported: true}});
  }
  return entries;
}

/** Standalone skills in a launch identity's skills folder: listed truthfully; Claude has no command to toggle them. */
export async function standaloneSkills(configDir: string, profile?: string): Promise<ModEntry[]> {
  const root = join(configDir, 'skills');
  let names: string[] = [];
  try { names = (await readdir(root, {withFileTypes: true})).filter(entry => entry.isDirectory() && entry.name !== 'synced' && !entry.name.startsWith('.')).map(entry => entry.name).slice(0, 128); } catch { return []; }
  const entries: ModEntry[] = [];
  for (const name of names) {
    let description = '';
    try {
      const head = (await readFile(join(root, name, 'SKILL.md'), 'utf8')).slice(0, 4096);
      description = text(/^description:\s*(.+)$/mu.exec(head)?.[1]?.replace(/^["']|["']$/gu, ''), 400);
    } catch { continue; }
    entries.push({key: `claude-skill:${profile ?? ''}:${name}`, id: text(name, 96), name: text(name, 96), kind: 'Provider-native', provider: 'claude', ...(profile ? {profileId: profile} : {}),
      ...(description ? {description} : {}), source: 'Personal skills folder', scope: 'global', reference: text(join(root, name), 512), installedBy: 'external', enabled: 'yes', managed: false,
      executesInside: 'Claude Code', sandbox: 'No', permissions: [], applicability: ['claude'], evidence: 'SKILL.md in the skills folder', nativeType: 'Skill',
      runtime: 'Claude reads it on demand in every session, managed ones included', notes: [],
      toggle: {supported: false, reason: 'Claude has no command to turn a personal skill off; move or delete its folder to remove it'}});
  }
  return entries;
}

export interface ToggleResult {ok: boolean; message: string; alreadyInGoalState?: boolean}

/**
 * Enable or disable an installed plugin at the scope it is installed at, through `claude plugin enable|disable
 * --scope … --json`. Only ids from the current listing are accepted: Claude's own command writes an unknown id into
 * settings as if it existed, so NMSh never sends one.
 */
export async function setPluginEnabled(executable: string, entry: ModEntry, enable: boolean, installed: ReadonlySet<string>): Promise<ToggleResult> {
  const claude = entry.claude;
  if (!claude || !PLUGIN_ID.test(claude.pluginId) || !installed.has(claude.pluginId)) return {ok: false, message: 'Not an installed Claude plugin in the current listing'};
  const args = ['plugin', enable ? 'enable' : 'disable', claude.pluginId, '--scope', claude.scope, '--json'];
  const env = claude.configDir ? {...process.env, CLAUDE_CONFIG_DIR: claude.configDir} : process.env;
  let stdout = '';
  try {
    ({stdout} = await run(executable, args, {cwd: claude.projectPath ?? process.cwd(), env, timeout: 30_000, maxBuffer: 256 * 1024, encoding: 'utf8'}));
  } catch (error) {
    // A failed command still prints its one JSON result line (exit 1).
    stdout = (error as {stdout?: string}).stdout ?? '';
    if (!stdout.trim()) return {ok: false, message: text((error as Error).message, 200) || 'Claude could not change the plugin'};
  }
  const line = stdout.split('\n').map(item => item.trim()).filter(Boolean).find(item => item.startsWith('{'));
  let result: {outcome?: unknown; message?: unknown; alreadyInGoalState?: unknown} | undefined;
  try { result = line ? JSON.parse(line) : undefined; } catch { result = undefined; }
  if (!result) return {ok: false, message: 'Claude answered in a shape NMSh does not know'};
  const alreadyInGoalState = result.alreadyInGoalState === true;
  return {ok: result.outcome === 'ok' || alreadyInGoalState, message: text(result.message, 300) || (result.outcome === 'ok' ? 'Done' : 'Claude refused the change'), ...(alreadyInGoalState ? {alreadyInGoalState} : {})};
}

/** Static inspection through Claude's own commands: components with token cost, and a mod's hooks and calls. */
export async function inspectPlugin(executable: string, entry: ModEntry): Promise<{details?: string; hooks: string[]; calls: string[]; error?: string}> {
  const claude = entry.claude;
  if (!claude || !PLUGIN_ID.test(claude.pluginId)) return {hooks: [], calls: [], error: 'Not a Claude plugin'};
  const env = claude.configDir ? {...process.env, CLAUDE_CONFIG_DIR: claude.configDir} : process.env;
  const options = {cwd: claude.projectPath ?? process.cwd(), env, timeout: 30_000, maxBuffer: 512 * 1024, encoding: 'utf8' as const};
  let details: string | undefined;
  try { details = displayText((await run(executable, ['plugin', 'details', claude.pluginId], options)).stdout).slice(0, 4000); } catch (error) { details = undefined; void error; }
  const hooks: string[] = [], calls: string[] = [];
  if (entry.components?.mod && entry.reference) {
    try {
      // `validate` lists a mod's hooks and API calls without running it (Claude's documented review step).
      const {stdout} = await run(executable, ['plugin', 'validate', entry.reference], options).catch(error => ({stdout: (error as {stdout?: string}).stdout ?? ''}));
      for (const line of stdout.split('\n')) {
        // Per-module lines only ("❯ ./register.tsx hooks: …"), never the "Validating hooks: <file>" header.
        const hook = /\s\.{0,2}\/\S+\s+hooks:\s*(.+)$/u.exec(line)?.[1];
        const call = /\s\.{0,2}\/\S+\s+calls:\s*(.+)$/u.exec(line)?.[1];
        if (hook) hooks.push(...hook.split(/,\s*(?![^{]*\})/u).map(item => text(item, 120)).filter(Boolean));
        if (call) calls.push(...call.split(/,\s*/u).map(item => text(item, 80)).filter(Boolean));
      }
    } catch { /* inspection is best effort */ }
  }
  return {...(details ? {details} : {}), hooks: hooks.slice(0, 64), calls: calls.slice(0, 64), ...(!details && !hooks.length ? {error: 'Claude could not describe this plugin'} : {})};
}

/** A mod whose only hooks draw (ui.render): nothing of it reaches a managed session. */
export function drawsOnly(hooks: readonly string[]): boolean {
  return hooks.length > 0 && hooks.every(hook => hook.startsWith('ui.'));
}

/** Claude's plugin listing for one launch identity (passive; no marketplace refresh). */
export async function listClaudePlugins(executable: string, cwd: string, configDir?: string): Promise<unknown> {
  const {stdout} = await run(executable, ['plugin', 'list', '--json'], {cwd, ...(configDir ? {env: {...process.env, CLAUDE_CONFIG_DIR: configDir}} : {}), timeout: 15_000, maxBuffer: 1024 * 1024, encoding: 'utf8'});
  return JSON.parse(stdout) as unknown;
}
