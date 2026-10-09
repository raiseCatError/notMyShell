import {createHash} from 'node:crypto';
import {displayText} from '../transcript/projection.js';
import type {ModEntry} from './model.js';

const text = (value: unknown, limit = 256) => typeof value === 'string' ? displayText(value).slice(0, limit) : '';
/** Rows of `claude plugin list --json` alone, synchronously (no manifest reads). The live inventory uses claudePlugins.ts. */
export function claudeInventory(value: unknown, cwd: string): ModEntry[] {
  if (!Array.isArray(value)) throw new Error('Claude plugin listing has an unsupported shape');
  return value.slice(0, 256).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return [];
    if (raw.scope === 'project' || raw.scope === 'local') {if (typeof raw.projectPath !== 'string' || raw.projectPath !== cwd) return [];}
    const id = text(raw.id); const reference = text(raw.installPath, 512);
    const scope = raw.scope === 'user' ? 'global' : raw.scope === 'project' || raw.scope === 'local' ? 'project' : 'unknown';
    const key = createHash('sha256').update(JSON.stringify([raw.id, raw.scope, raw.projectPath, raw.installPath])).digest('hex');
    // `enabled` is the installation's state; `projectEnabled` only says whether project settings name it (false for
    // nearly every user-scope plugin), so it never decides the state shown. Project overrides: claudePlugins.ts.
    const enabled = raw.enabled;
    return [{key: `claude:${key}`, id, name: id, kind: 'Provider-native' as const, provider: 'claude', source: 'Claude Code plugin list --json',
      ...(text(raw.version) ? {version: text(raw.version)} : {}), scope, ...(reference ? {reference} : {}), installedBy: 'unknown' as const,
      enabled: enabled === true ? 'yes' as const : enabled === false ? 'no' as const : 'unknown' as const, managed: false, executesInside: 'Claude Code', sandbox: 'No' as const,
      permissions: [], applicability: ['claude'], evidence: 'Provider listing; provenance and privileges unknown'}];
  });
}
