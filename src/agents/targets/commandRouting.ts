import type {AgentSession} from '../sessions/model.js';

export type ProviderRoute = {kind: 'launch'; provider: string} | {kind: 'focus'; targetId: string} | {kind: 'picker'; targetIds: string[]} | {kind: 'mods'; provider: string};
export function providerRoute(provider: string, action: 'open' | 'new' | 'mods', cwd: string, sessions: readonly AgentSession[]): ProviderRoute {
  if (action === 'mods') return {kind: 'mods', provider};
  if (action === 'new') return {kind: 'launch', provider};
  const relevant = sessions.filter(s => s.harness === provider && s.cwd === cwd && s.level === 'managed' && (!['exited', 'failed'].includes(s.state) || s.reconnectable));
  if (relevant.length === 1) return {kind: 'focus', targetId: relevant[0]!.id};
  if (relevant.length > 1) return {kind: 'picker', targetIds: relevant.map(s => s.id)};
  return {kind: 'launch', provider};
}

/** Exact bare invocation only, and only after runtime proof and shell resolution. */
export function bareProviderRoute(command: string, resolution: Readonly<Record<string, string>>, proven: boolean): string | undefined {
  return proven && command.trim() === 'claude' && resolution.claude === 'executable' ? 'claude' : undefined;
}
