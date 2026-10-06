import type {CapabilityDefinition} from './capability.js';
import {PROJECT_CAPABILITIES} from './capabilities/project.js';
import {RUNTIME_CAPABILITIES} from './capabilities/runtimes.js';
import {ENVIRONMENT_CAPABILITIES} from './capabilities/environment.js';
import {INFRASTRUCTURE_CAPABILITIES} from './capabilities/infrastructure.js';
import {CLOUD_CAPABILITIES} from './capabilities/cloud.js';
import {SYSTEM_CAPABILITIES} from './capabilities/system.js';
import {VCS_CAPABILITIES} from './capabilities/vcs.js';
import {AGENT_CAPABILITIES} from './capabilities/agents.js';

/**
 * Every trusted capability NMSh core implements. This list is the whole
 * authority surface of context collection: modules and Context Packs can only
 * name these ids and their declared fields. Adding one is a core code change
 * with review, never something a pack or repository can do.
 */
export const CORE_CAPABILITIES: readonly CapabilityDefinition<unknown>[] = [
  ...PROJECT_CAPABILITIES as CapabilityDefinition<unknown>[], ...RUNTIME_CAPABILITIES, ...ENVIRONMENT_CAPABILITIES, ...INFRASTRUCTURE_CAPABILITIES,
  ...CLOUD_CAPABILITIES, ...SYSTEM_CAPABILITIES, ...VCS_CAPABILITIES, ...AGENT_CAPABILITIES,
];

const BY_ID = new Map(CORE_CAPABILITIES.map(capability => [capability.id, capability]));

export function coreCapability(id: string): CapabilityDefinition<unknown> | undefined {
  return BY_ID.get(id);
}
