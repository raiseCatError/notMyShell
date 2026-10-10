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
}
export const CONTEXT_METER = {id: 'context-meter', name: 'Context Meter', requested: ['context.status'], providers: ['claude', 'codex'], execution: 'inert'} as const;
export function builtinModInventory(): ModEntry[] {
  return [{key: 'portable:context-meter', id: CONTEXT_METER.id, name: CONTEXT_METER.name, kind: 'Portable', provider: 'nmsh',
    description: 'Inert capability-bound fixture; no executable mod code. Not activated in the product.', source: 'NMSh built-in descriptor', version: '1', scope: 'target',
    installedBy: 'nmsh', enabled: 'no', managed: true, executesInside: 'none (inert)', sandbox: 'Not executable', permissions: CONTEXT_METER.requested, applicability: CONTEXT_METER.providers, evidence: 'Built-in descriptor; no granted product instances'}];
}
