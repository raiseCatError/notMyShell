import {moduleDefinition} from '../context/modules.js';
import {CORE_CAPABILITIES} from '../context/registry.js';
import {routeModule, surfaceAvailability} from '../context/surfaceRouter.js';
import {MODULE_SURFACE_LABELS, type ContextModuleConfig, type ModuleSurface, type PromptConfiguration} from './configuration.js';
import {whyText, type ModulesContext} from './ModulesPanel.js';

/**
 * Plain-text module diagnostics for the transcript (#365), in the spirit of `starship explain` and `starship timings`:
 * `/modules explain` says, per configured module, where it is routed, whether it is on screen and why, and the state of
 * the capabilities it reads; `/modules timings` lists the slowest last collections. Both read the engine's snapshots
 * and the settings only: nothing is collected, run or read from disk to produce them, and no module value is shown
 * (only states, ages, durations and the capabilities' own evidence summaries).
 */

type Status = NonNullable<ReturnType<NonNullable<ModulesContext['status']>>>;

const inert = (text: string, limit: number) => text.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, ' ').slice(0, limit);
const age = (status: Status, now: number) => status.collectedAt === undefined ? '' : ` ${Math.max(0, Math.round((now - status.collectedAt) / 1000))}s ago`;
const took = (status: Status) => status.durationMs === undefined ? '' : `, took ${status.durationMs < 1 ? '<1' : Math.round(status.durationMs)} ms`;
const STATE: Record<string, string> = {fresh: 'fresh', stale: 'stale', pending: 'collecting', absent: 'nothing to show', timeout: 'timed out', failed: 'failed', idle: 'not collected'};

export function explainModules(modules: readonly ContextModuleConfig[], context: ModulesContext, configuration: PromptConfiguration, now = Date.now(),
  fit?: (id: string, surface: string) => 'dropped' | 'compacted' | undefined): string[] {
  const rows: string[] = [];
  for (const module of modules) {
    const definition = moduleDefinition(module.id);
    if (!definition) { rows.push(`${inert(module.id, 64)} · its Context Pack is not installed or enabled; nothing is collected`); continue; }
    const surface = routeModule(module);
    const availability = surface === 'hidden' ? undefined : surfaceAvailability(surface, configuration);
    const sourced = [...definition.facts.keys()].map(id => ({id, status: context.status?.(id)})).filter((entry): entry is {id: string; status: Status} => Boolean(entry.status));
    const statuses = sourced.map(entry => entry.status);
    const why = !module.visible ? 'turned off in Modules'
      : availability && !availability.available ? availability.reason
        : context.conditionMet?.(module) === false ? 'hidden: its condition does not match here'
          : whyText(module, surface, statuses, definition.triggers);
    const where = surface === 'hidden' ? 'Hidden' : MODULE_SURFACE_LABELS[surface as ModuleSurface];
    // Width: what the last frame's fitting did on its surface (higher priorities are kept, then shortened, longest).
    const fitted = module.visible && surface !== 'hidden' && (!availability || availability.available) ? fit?.(module.id, surface) : undefined;
    const width = fitted === 'dropped' ? ' · left out for width in the last frame (higher-priority modules kept)'
      : fitted === 'compacted' ? ' · shortened to fit the width in the last frame' : '';
    rows.push(`${inert(definition.label, 48)} (${module.id}) · ${where} · ${inert(why, 200)}${width}`);
    const sources = sourced.map(({id, status}) => `${id} ${STATE[status.state] ?? status.state}${age(status, now)}${took(status)}${status.evidence ? ` (${inert(status.evidence, 80)})` : ''}`);
    if (sources.length) rows.push(`  reads ${sources.join('; ')}`);
  }
  if (!rows.length) rows.push('No modules are configured.');
  rows.push('States come from this window\'s Context Engine; producing this report collected nothing.');
  return rows;
}

export function moduleTimings(status: (id: string) => Status | undefined, now = Date.now(), limit = 15): string[] {
  const measured = CORE_CAPABILITIES.map(capability => ({id: capability.id, ...status(capability.id)})).filter((entry): entry is Status & {id: string} => entry.durationMs !== undefined)
    .sort((a, b) => b.durationMs! - a.durationMs!);
  if (!measured.length) return ['No module data has been collected in this window yet.'];
  const rows = measured.slice(0, limit).map(entry => `${String(entry.durationMs! < 1 ? '<1' : Math.round(entry.durationMs!)).padStart(6)} ms  ${entry.id} · ${STATE[entry.state] ?? entry.state}${age(entry, now)}`);
  if (measured.length > limit) rows.push(`… ${measured.length - limit} faster ones not listed`);
  rows.push('Wall time of each capability\'s last collection, excluding time queued; nothing was collected to show this.');
  return rows;
}
