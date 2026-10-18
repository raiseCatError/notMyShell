import type {AgentEvent, AgentLevel} from '../sessions/model.js';

export const TARGET_CAPABILITIES = ['conversation.read', 'message.send', 'tool.observe', 'task.cancel', 'session.status', 'context.status', 'tool.approve'] as const;
export type TargetCapability = typeof TARGET_CAPABILITIES[number];
export interface CapabilityFact {
  targetId: string;
  capability: TargetCapability;
  availability: 'available' | 'unavailable' | 'unknown';
  evidence: string;
  reason?: string;
  observedAt?: number;
}
export type CapabilityFacts = Record<TargetCapability, CapabilityFact>;

export function capabilityFacts(targetId: string, level: AgentLevel, provider: string): CapabilityFacts {
  return Object.fromEntries(TARGET_CAPABILITIES.map(capability => {
    const status = capability === 'session.status';
    const controlled = level === 'managed' && provider === 'claude';
    return [capability, {targetId, capability, availability: status ? 'available' : controlled ? 'unknown' : 'unavailable',
      evidence: status ? 'NMSh lifecycle record' : 'No observed structured operation yet',
      ...(!status ? {reason: controlled ? 'Awaiting provider evidence' : level === 'observed' ? 'Observed process metadata only' : level === 'attachable' ? 'Structured reconnection not proven' : 'No supported adapter'} : {})}];
  })) as CapabilityFacts;
}

export function updateCapabilities(facts: CapabilityFacts, event: AgentEvent, now: number): void {
  const available = (capability: TargetCapability, evidence: string) => {
    const fact = facts[capability];
    if (fact.availability === 'unavailable') return;
    fact.availability = 'available'; fact.evidence = evidence; fact.observedAt = now; delete fact.reason;
  };
  if (event.kind === 'started') available('message.send', 'Observed stream-json initialization; adapter message framing');
  if (event.kind === 'assistant') available('conversation.read', 'Observed eligible structured assistant text');
  if (event.kind === 'tool') available('tool.observe', 'Observed structured tool event');
  if (event.kind === 'approval') available('tool.approve', 'Observed host can_use_tool request; human response controller only');
  // Interrupt/resume/context need their own evidence; presence of a process proves none of them.
  if (event.kind === 'exited') for (const capability of ['message.send', 'task.cancel', 'tool.approve'] as const) {
    facts[capability] = {...facts[capability], availability: 'unavailable', evidence: 'Provider exited', reason: 'Target process ended', observedAt: now};
  }
}
