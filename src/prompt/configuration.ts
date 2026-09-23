import {readFileSync} from 'node:fs';
import {promptConfigurationPath} from '../configuration/paths.js';

export type ContextPlacement = 'header' | 'composer';
export type ContextModuleId = 'project' | 'cwd' | 'gitBranch' | 'exitStatus';
export type ContextCondition = 'always' | 'inRepository' | 'nonzeroExit';

export interface ContextModuleConfig {
  id: ContextModuleId;
  visible: boolean;
  condition: ContextCondition;
  foreground?: string;
  background?: string;
}

export interface PromptConfiguration {
  placement: ContextPlacement;
  modules: ContextModuleConfig[];
  separator: string;
  /** Spaces between colored context blocks; use spacing for padding inside each block. */
  gap: number;
  spacing: number;
}

export const DEFAULT_PROMPT_CONFIGURATION: PromptConfiguration = {
  placement: 'header',
  modules: [
    {id: 'project', visible: true, condition: 'always'},
    {id: 'cwd', visible: true, condition: 'always'},
    {id: 'gitBranch', visible: true, condition: 'inRepository'},
    {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
  ],
  separator: '',
  gap: 1,
  spacing: 1,
};

const MODULE_IDS = new Set<ContextModuleId>(['project', 'cwd', 'gitBranch', 'exitStatus']);
const CONDITIONS = new Set<ContextCondition>(['always', 'inRepository', 'nonzeroExit']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
}

function validSeparator(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8 && !/[\u0000-\u001f\u007f\u001b]/u.test(value);
}

export function normalizePromptConfiguration(value: unknown): PromptConfiguration {
  if (!isRecord(value)) return structuredClone(DEFAULT_PROMPT_CONFIGURATION);

  const placement: ContextPlacement = value.placement === 'composer' ? 'composer' : 'header';
  const spacing = typeof value.spacing === 'number' && Number.isFinite(value.spacing)
    ? Math.max(0, Math.min(3, Math.round(value.spacing)))
    : DEFAULT_PROMPT_CONFIGURATION.spacing;
  const gap = typeof value.gap === 'number' && Number.isFinite(value.gap)
    ? Math.max(0, Math.min(3, Math.round(value.gap)))
    : DEFAULT_PROMPT_CONFIGURATION.gap;
  const separator = validSeparator(value.separator) ? value.separator : DEFAULT_PROMPT_CONFIGURATION.separator;

  if (!Array.isArray(value.modules)) {
    return {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), placement, spacing, gap, separator};
  }

  const modules: ContextModuleConfig[] = [];
  const seen = new Set<ContextModuleId>();
  for (const item of value.modules) {
    if (!isRecord(item) || typeof item.id !== 'string' || !MODULE_IDS.has(item.id as ContextModuleId)) continue;
    const id = item.id as ContextModuleId;
    if (seen.has(id)) continue;
    seen.add(id);
    const fallback = DEFAULT_PROMPT_CONFIGURATION.modules.find(module => module.id === id)!;
    const module: ContextModuleConfig = {
      id,
      visible: typeof item.visible === 'boolean' ? item.visible : fallback.visible,
      condition: typeof item.condition === 'string' && CONDITIONS.has(item.condition as ContextCondition)
        ? item.condition as ContextCondition
        : fallback.condition,
    };
    if (validColor(item.foreground)) module.foreground = item.foreground;
    if (validColor(item.background)) module.background = item.background;
    modules.push(module);
  }

  return {placement, modules, separator, spacing, gap};
}

export function loadPromptConfiguration(path = promptConfigurationPath()): PromptConfiguration {
  try {
    return normalizePromptConfiguration(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  }
}

export function hasVisibleContextModule(
  configuration: PromptConfiguration,
  context?: {branch?: string; exitStatus?: number},
): boolean {
  return configuration.modules.some(module => module.visible
    && (module.condition !== 'inRepository' || Boolean(context?.branch))
    && (module.condition !== 'nonzeroExit' || (context?.exitStatus ?? 0) !== 0));
}
