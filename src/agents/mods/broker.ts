import type {CapabilityFacts} from '../targets/capabilities.js';
import {displayText} from '../transcript/projection.js';

export type ModPermission = 'context.status' | 'session.status' | 'conversation.read' | 'tool.observe' | 'approval.observe' | 'approval.decorate' | 'approval.explain' | 'targets.list' | 'targets.aggregate';
const READ_PERMISSIONS = new Set<ModPermission>(['context.status', 'session.status', 'targets.list', 'targets.aggregate']);
export interface PortableDescriptor {id: string; name: string; requested: readonly ModPermission[]; providers: readonly string[]; execution: 'inert'}
export interface TargetSnapshot {id: string; provider: string; capabilities: CapabilityFacts; context?: {percent: number; observedAt: number}; state?: string}
export type ModResult = {ok: true; value: unknown} | {ok: false; reason: string};
export interface ModAPI {readonly identity: Readonly<{modId: string; targetId: string; instanceId: string}>; request(permission: ModPermission): ModResult}

/** Controlled read-only fixture broker. No executable loader or provider handle crosses it. */
export class ModBroker {
  constructor(private readonly snapshots: () => readonly TargetSnapshot[]) {}
  bind(descriptor: PortableDescriptor, targetId: string, instanceId: string, grants: readonly ModPermission[]): ModAPI {
    const allowed = new Set(grants.filter(p => descriptor.requested.includes(p) && READ_PERMISSIONS.has(p)));
    const providers = [...descriptor.providers];
    return Object.freeze({identity: Object.freeze({modId: descriptor.id, targetId, instanceId}), request: (permission: ModPermission): ModResult => {
      if (!allowed.has(permission)) return {ok: false, reason: 'Capability not granted (deny by default)'};
      const targets = this.snapshots();
      const target = targets.find(t => t.id === targetId);
      if (!target || !providers.includes(target.provider)) return {ok: false, reason: 'Target unavailable or not applicable'};
      const context = (t: TargetSnapshot) => t.capabilities['context.status'].availability === 'available' && t.context && Number.isFinite(t.context.percent) && t.context.percent >= 0 && t.context.percent <= 100
        ? {targetId: t.id, percent: t.context.percent, observedAt: t.context.observedAt} : undefined;
      if (permission === 'targets.list') return {ok: true, value: targets.slice(0, 64).map(t => ({id: displayText(t.id).slice(0, 160), provider: displayText(t.provider).slice(0, 80)}))};
      if (permission === 'targets.aggregate') return {ok: true, value: targets.slice(0, 64).flatMap(t => {const c = context(t); return c ? [c] : [];})};
      if (permission === 'context.status') {const c = context(target); return c ? {ok: true, value: c} : {ok: false, reason: target.capabilities['context.status'].reason ?? 'Context unavailable'};}
      if (permission === 'session.status') return {ok: true, value: {targetId, state: displayText(target.state ?? 'unknown').slice(0, 80)}};
      return {ok: false, reason: 'Not implemented for portable instances'};
    }});
  }
}

export class PortableInstance {
  private value: Record<string, unknown> = {};
  error?: string;
  constructor(readonly api: ModAPI) {}
  get state(): Record<string, unknown> {return structuredClone(this.value);}
  setState(state: Record<string, unknown>): boolean {
    try {
      const text = JSON.stringify(state);
      if (Buffer.byteLength(text) > 65536) {this.error = 'Instance state exceeds 64 KiB limit'; return false;}
      this.value = JSON.parse(text) as Record<string, unknown>; return true;
    } catch {this.error = 'Instance state must be bounded plain data'; return false;}
  }
  /** Host-controlled inert fixture evaluation; never arbitrary imported third-party code. */
  update(project: () => void): void {try {project();} catch (error) {this.error = displayText(error instanceof Error ? error.message : 'Instance failed').slice(0, 160);}}
}
