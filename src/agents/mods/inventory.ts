import {join} from 'node:path';
import {firstPartyPacks} from '../../context/modules.js';
import {installedPackStatuses, readManifest} from '../../context/packs/store.js';
import {claudeSettingsPath} from '../claudeStatusLine.js';
import {resolveCommand} from '../../providers/providers.js';
import {discoverClaudePlugins} from './claudeDiscovery.js';
import {builtinModInventory, type ModEntry} from './model.js';
import {displayText} from '../transcript/projection.js';
import type {AgentProfile} from '../sessions/manager.js';

export async function discoverHooks(paths: readonly {path: string; scope: 'global' | 'project'}[]): Promise<ModEntry[]> {
  const entries: ModEntry[] = [];
  for (const {path, scope} of paths) {
    const read = await readManifest(path);
    if ('error' in read) {if (read.error === 'no such file') continue; throw new Error(`Hook metadata ${read.error}`);}
    let value; try {value = JSON.parse(read.bytes.toString('utf8'));} catch {throw new Error('Hook metadata is not valid JSON');}
    if (!value.hooks || typeof value.hooks !== 'object') continue;
    for (const [event, groups] of Object.entries(value.hooks).slice(0, 64)) {
      if (!Array.isArray(groups)) continue;
      groups.slice(0, 64).forEach((group, index) => {
        if (!Array.isArray(group?.hooks)) return;
        group.hooks.slice(0, 32).forEach((hook: unknown, n: number) => {
          if (!hook || typeof hook !== 'object') return;
          const id = `${displayText(event).slice(0, 80)} hook ${index + 1}.${n + 1}`;
          entries.push({key: JSON.stringify(['claude-hook', path, event, index, n]), id, name: id, kind: 'Provider-native', provider: 'claude', source: 'Claude settings hook declaration', scope,
            reference: displayText(path).slice(0, 512), installedBy: 'unknown', enabled: value.disableAllHooks === true ? 'no' : 'unknown', managed: false, executesInside: 'Claude Code', sandbox: 'No', permissions: [], applicability: ['claude'], evidence: 'Passive declaration only; effective provider settings/activation not inferred'});
        });
      });
    }
  }
  return entries.slice(0, 256);
}

export async function loadModInventory(cwd: string, version: string, profiles: readonly AgentProfile[] = []): Promise<ModEntry[]> {
  const entries = builtinModInventory();
  for (const {pack} of firstPartyPacks()) entries.push({key: `pack:builtin:${pack.id}`, id: pack.id, name: pack.name, description: pack.description, version: pack.version, kind: 'Context Packs', provider: 'nmsh', source: 'NMSh bundled Context Pack', scope: 'global', installedBy: 'nmsh', enabled: 'unknown', managed: true, executesInside: 'none (declarative)', sandbox: 'Not executable', permissions: pack.requires, applicability: [], evidence: 'Bundled manifest; individual module activation is configured separately'});
  for (const status of await installedPackStatuses(undefined, version)) entries.push({key: `pack:installed:${status.record.id}`, id: status.record.id, name: status.parsed?.pack.name ?? status.record.id, description: status.parsed?.pack.description, version: status.record.version, kind: 'Context Packs', provider: 'nmsh', source: status.record.source, scope: 'global', installedBy: 'nmsh', enabled: status.state === 'enabled' ? 'yes' : status.state === 'disabled' ? 'no' : 'unknown', managed: true, executesInside: 'none (declarative)', sandbox: 'Not executable', permissions: status.parsed?.pack.requires ?? [], applicability: [], evidence: status.message ?? `Registry/hash status: ${status.state}; integrity does not establish trust`});
  const executable = resolveCommand('claude');
  const claudeProfiles = profiles.filter(p => p.harness === 'claude');
  const namespaces = claudeProfiles.length ? claudeProfiles : [undefined];
  for (const profile of namespaces) {
    const native = executable ? await discoverClaudePlugins(executable, cwd, profile?.configDir) : [];
    native.push(...await discoverHooks([{path: profile?.configDir ? join(profile.configDir, 'settings.json') : claudeSettingsPath(), scope: 'global'}, {path: join(cwd, '.claude', 'settings.json'), scope: 'project'}, {path: join(cwd, '.claude', 'settings.local.json'), scope: 'project'}]));
    entries.push(...native.map(i => profile ? {...i, profileId: profile.name, key: JSON.stringify([profile.name, i.key])} : i));
  }
  return entries;
}
