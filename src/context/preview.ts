import {PREVIEW_NOW} from './capability.js';
import {sanitizeFactValue, type ContextFact, type ContextFacts} from './facts.js';
import {allModuleDefinitions} from './modules.js';
import {CORE_CAPABILITIES} from './registry.js';

/**
 * Deterministic synthetic facts for showcases and previews: every capability's
 * declared preview value, at a pinned clock. Nothing is collected, read or
 * run; previews exercise the same rendering path as live facts.
 */
export function capabilityPreviewFacts(): ContextFacts {
  const facts: Record<string, ContextFact<unknown>> = {};
  for (const capability of CORE_CAPABILITIES) {
    facts[capability.id] = {value: sanitizeFactValue(capability.preview), source: {capability: capability.id, evidence: 'synthetic preview'},
      collectedAt: PREVIEW_NOW, freshness: 'fresh', trust: capability.trust, sensitivity: capability.sensitivity, persistence: capability.persistence,
      resolution: capability.cost, ...(capability.fieldPolicy ? {fieldPolicy: capability.fieldPolicy} : {})};
  }
  return facts as ContextFacts;
}

/** Every show-on-command word, so previews show command-context modules as if their commands were typed. */
export function previewCommandWords(): string[] {
  return [...new Set(allModuleDefinitions().flatMap(definition => definition.triggers ?? []))];
}

export {PREVIEW_NOW};
