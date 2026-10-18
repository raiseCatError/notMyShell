import type {PromptConfiguration} from '../prompt/configuration.js';
import {COMMAND_CONTEXT_TRIGGERS, matchesCommand, TOOLCHAIN_TRIGGERS} from '../prompt/commandContext.js';
import type {ContextDemand} from './engine.js';
import {moduleDefinition} from './modules.js';
import {routeModule} from './surfaceRouter.js';

/**
 * What the Context Engine should resolve right now, derived purely from
 * configuration and the live presentation state. A module contributes demand
 * only when it is visible, routed to a surface that is actually showing, and
 * (for show-on-command) relevant to the words being typed. Hidden, disabled,
 * missing and irrelevant modules contribute nothing, so they cost nothing.
 */
export interface DemandInput {
  commandWords: readonly string[];
  /** The Native prompt is the active provider (external providers and None render no Native modules). */
  nativePrompt: boolean;
  /** The Context Rail can show content (Native, not Off, not passthrough). */
  railVisible: boolean;
  /** The Status Strip row is enabled and showing. */
  statusStripVisible: boolean;
  inRepository: boolean;
}

/** Whether a show-on-command module is relevant to the command words (built-in trigger tables or the pack's own words). */
export function moduleRelevantToCommand(id: string, words: readonly string[]): boolean {
  if (id === 'kubeContext' || id === 'dockerContext') return matchesCommand(COMMAND_CONTEXT_TRIGGERS[id], words);
  if (id === 'toolchain') return Object.values(TOOLCHAIN_TRIGGERS).some(triggers => matchesCommand(triggers, words));
  return matchesCommand(moduleDefinition(id)?.triggers ?? [], words);
}

/**
 * The Status Strip's own items (clock, CPU, RAM, battery, uptime) are Context
 * Engine facts like any module's: demanded only while the strip row is showing
 * and only for the items switched on, so a hidden strip collects nothing.
 */
export function statusStripDemand(strip: PromptConfiguration['statusStrip'] | undefined, visible: boolean): Array<[string, readonly string[]]> {
  if (!strip?.enabled || !visible) return [];
  return [
    ...(strip.clock ? [['system.time', ['now']] as [string, string[]]] : []),
    ...(strip.cpu ? [['system.cpu', ['percent']] as [string, string[]]] : []),
    ...(strip.ram ? [['system.memory', ['usedPercent', 'usedBytes', 'totalBytes']] as [string, string[]]] : []),
    ...(strip.battery ? [['system.battery', ['percent', 'charging']] as [string, string[]]] : []),
    ...(strip.uptime ? [['system.uptime', ['seconds']] as [string, string[]]] : []),
  ];
}

export function contextDemand(configuration: Pick<PromptConfiguration, 'modules'> & Partial<Pick<PromptConfiguration, 'statusStrip'>>, input: DemandInput): ContextDemand {
  const demand = new Map<string, Set<string>>();
  for (const [capability, fields] of statusStripDemand(configuration.statusStrip, input.statusStripVisible)) {
    const set = demand.get(capability) ?? new Set<string>();
    for (const field of fields) set.add(field);
    demand.set(capability, set);
  }
  for (const module of configuration.modules) {
    const definition = moduleDefinition(module.id);
    if (!definition || !module.visible || !definition.facts.size) continue;
    const surface = routeModule(module);
    if (surface === 'hidden') continue;
    if (surface === 'statusStrip' ? !input.statusStripVisible : !input.nativePrompt) continue;
    if (surface === 'contextRail' && !input.railVisible) continue;
    if (module.condition === 'onCommand' && !moduleRelevantToCommand(module.id, input.commandWords)) continue;
    if (module.condition === 'inRepository' && !input.inRepository) continue;
    for (const [capability, fields] of definition.facts) {
      const set = demand.get(capability) ?? new Set<string>();
      for (const field of fields) set.add(field);
      demand.set(capability, set);
    }
  }
  return demand;
}
