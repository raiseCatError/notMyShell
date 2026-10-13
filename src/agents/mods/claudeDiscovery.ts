import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {displayText} from '../transcript/projection.js';
import type {ModEntry} from './model.js';

const run = promisify(execFile);
const text = (value: unknown, limit = 256) => typeof value === 'string' ? displayText(value).slice(0, limit) : '';
/** Installed 2.1.292 listing schema. No importing or reading executable plugin files. */
export function claudeInventory(value: unknown, cwd: string): ModEntry[] {
  if (!Array.isArray(value)) throw new Error('Claude plugin listing has an unsupported shape');
  return value.slice(0, 256).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return [];
    if (raw.scope === 'project' || raw.scope === 'local') {if (typeof raw.projectPath !== 'string' || raw.projectPath !== cwd) return [];}
    const id = text(raw.id); const reference = text(raw.installPath, 512);
    const scope = raw.scope === 'user' ? 'global' : raw.scope === 'project' || raw.scope === 'local' ? 'project' : 'unknown';
    const key = createHash('sha256').update(JSON.stringify([raw.id, raw.scope, raw.projectPath, raw.installPath])).digest('hex');
    const enabled = typeof raw.projectEnabled === 'boolean' ? raw.projectEnabled : raw.enabled;
    return [{key: `claude:${key}`, id, name: id, kind: 'Provider-native' as const, provider: 'claude', source: 'Claude Code plugin list --json',
      ...(text(raw.version) ? {version: text(raw.version)} : {}), scope, ...(reference ? {reference} : {}), installedBy: 'unknown' as const,
      enabled: enabled === true ? 'yes' as const : enabled === false ? 'no' as const : 'unknown' as const, managed: false, executesInside: 'Claude Code', sandbox: 'No' as const,
      permissions: [], applicability: ['claude'], evidence: typeof raw.projectEnabled === 'boolean' ? 'Provider projectEnabled for current workspace; installation enabled state may differ' : 'Provider listing; provenance and privileges unknown'}];
  });
}

/** Trusted provider's supported passive command; bounded, no marketplace sync or activation. */
export async function discoverClaudePlugins(executable: string, cwd: string, configDir?: string): Promise<ModEntry[]> {
  const {stdout} = await run(executable, ['plugin', 'list', '--json'], {cwd, ...(configDir ? {env: {...process.env, CLAUDE_CONFIG_DIR: configDir}} : {}), timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8'});
  return claudeInventory(JSON.parse(stdout), cwd);
}
