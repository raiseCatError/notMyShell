import type {ContextFacts} from '../facts.js';
import {packModuleId, type PackModuleId} from '../modules.js';
import type {PromptConfiguration} from '../../prompt/configuration.js';
import type {ParsedPack} from './schema.js';

/**
 * Deterministic module recommendations. Each one names the local evidence it
 * rests on (a marker file in this project, an executable in the shared
 * inventory, a fact core already resolved) and is only ever shown: nothing is
 * installed, enabled or selected because of it.
 */
export interface Recommendation {
  module: PackModuleId;
  pack: string;
  label: string;
  reasons: string[];
}

export interface RecommendationEvidence {
  /** Entry names in the working directory and repository root (one bounded listing each). */
  workspaceNames: ReadonlySet<string>;
  /** Executable names from the shared local inventory, when it has been collected. */
  executables: ReadonlySet<string>;
  facts: ContextFacts;
}

export function recommendModules(configuration: Pick<PromptConfiguration, 'modules'>, evidence: RecommendationEvidence, packs: readonly ParsedPack[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  for (const parsed of packs) {
    for (const rule of parsed.pack.recommend ?? []) {
      const id = packModuleId(parsed.pack.id, rule.module);
      if (configuration.modules.some(module => module.id === id && module.visible)) continue;
      const reasons: string[] = [];
      for (const item of rule.evidence) {
        if (item.kind === 'workspaceFile') {
          const found = item.names.filter(name => evidence.workspaceNames.has(name));
          if (found.length) reasons.push(`${found.slice(0, 3).join(', ')} in this project`);
        } else if (item.kind === 'workspaceExtension') {
          const found = [...evidence.workspaceNames].filter(name => item.extensions.some(extension => name.endsWith(extension))).sort();
          if (found.length) reasons.push(`${found.slice(0, 2).join(', ')}${found.length > 2 ? ` and ${found.length - 2} more` : ''} in this project`);
        } else if (item.kind === 'executable') {
          const found = item.names.filter(name => evidence.executables.has(name));
          if (found.length) reasons.push(`${found.join(', ')} is installed`);
        } else if ((evidence.facts as Record<string, unknown>)[item.fact]) {
          reasons.push('local configuration found');
        }
      }
      const module = parsed.pack.modules.find(item => item.id === rule.module);
      if (reasons.length && module) recommendations.push({module: id, pack: parsed.pack.name, label: module.label, reasons: [...new Set(reasons)]});
    }
  }
  return recommendations;
}
