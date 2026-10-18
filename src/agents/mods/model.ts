export type ModKind = 'Portable' | 'Provider-native' | 'Context Packs';
export interface ModEntry {
  key: string; id: string; name: string; kind: ModKind; provider: string;
  profileId?: string;
  description?: string; source: string; version?: string;
  scope: 'global' | 'project' | 'target' | 'unknown'; reference?: string;
  installedBy: 'nmsh' | 'provider' | 'external' | 'unknown';
  enabled: 'yes' | 'no' | 'unknown'; managed: boolean;
  executesInside: string; sandbox: 'No' | 'Not executable' | 'Unknown';
  permissions: readonly string[]; applicability: readonly string[];
  evidence: string;
  /** The provider's own kind: a mod (code inside the provider), a plugin, a settings hook, a skill. */
  nativeType?: 'Mod' | 'Plugin' | 'Settings hook' | 'Skill';
  components?: ModComponents;
  /** What the entry does in an NMSh-managed session, in words. */
  runtime?: string;
  /** Conflicts, overrides, dependencies and options, in words. */
  notes?: readonly string[];
  /** Whether NMSh can turn it on or off through a supported provider command, and why not. */
  toggle?: {supported: true} | {supported: false; reason: string};
  /** Facts NMSh needs to change a Claude plugin through Claude's own command. */
  claude?: {pluginId: string; scope: 'user' | 'project' | 'local'; projectPath?: string; configDir?: string};
  /** Managed targets whose provider reported this plugin loaded (evidence that it is active there). */
  loadedIn?: readonly string[];
}

export interface ModComponents {mod: boolean; hookEvents: number; skills: number; agents: number; commands: number; mcp: boolean; lsp: boolean}
export const CONTEXT_METER = {id: 'context-meter', name: 'Context Meter', requested: ['context.status'], providers: ['claude', 'codex'], execution: 'inert'} as const;
export function builtinModInventory(): ModEntry[] {
  return [{key: 'portable:context-meter', id: CONTEXT_METER.id, name: CONTEXT_METER.name, kind: 'Portable', provider: 'nmsh',
    description: 'Inert capability-bound fixture; no executable mod code. Not activated in the product.', source: 'NMSh built-in descriptor', version: '1', scope: 'target',
    installedBy: 'nmsh', enabled: 'no', managed: true, executesInside: 'none (inert)', sandbox: 'Not executable', permissions: CONTEXT_METER.requested, applicability: CONTEXT_METER.providers, evidence: 'Built-in descriptor; no granted product instances'}];
}
