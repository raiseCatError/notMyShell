import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {promptConfigurationPath} from '../configuration/paths.js';

export type ContextPlacement = 'header' | 'composer';
export type ComposerLayout = 'oneLine' | 'twoLine';
export type ContextModuleId = 'project' | 'cwd' | 'gitBranch' | 'exitStatus';
export type ContextCondition = 'always' | 'inRepository' | 'nonzeroExit';
export type PromptProviderId = 'nmsh' | 'starship';
export type NativeEndStyle = 'fadeWedge' | 'wedge' | 'fadeFlat' | 'flat';

export interface ContextModuleConfig {
  id: ContextModuleId;
  visible: boolean;
  condition: ContextCondition;
  foreground?: string;
  background?: string;
}

export interface PromptConfiguration {
  provider: PromptProviderId;
  onboardingComplete: boolean;
  nmsh: {gapEnabled: boolean; endStyle: NativeEndStyle; palette: 'lavender'};
  starship: {configPath: string | null};
  placement: ContextPlacement;
  composerLayout: ComposerLayout;
  modules: ContextModuleConfig[];
  separator: string;
  /** Spaces between colored context blocks; use spacing for padding inside each block. */
  gap: number;
  spacing: number;
}

export const DEFAULT_PROMPT_CONFIGURATION: PromptConfiguration = {
  provider: 'nmsh',
  onboardingComplete: false,
  nmsh: {gapEnabled: true, endStyle: 'fadeWedge', palette: 'lavender'},
  starship: {configPath: null},
  placement: 'header',
  composerLayout: 'twoLine',
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

  const promptValue = isRecord(value.prompt) ? value.prompt : value;
  const provider: PromptProviderId = promptValue.provider === 'starship' ? 'starship' : 'nmsh';
  const nativeValue = isRecord(promptValue.nmsh) ? promptValue.nmsh : promptValue;
  const starshipValue = isRecord(promptValue.starship) ? promptValue.starship : {};
  const endStyle: NativeEndStyle = nativeValue.endStyle === 'wedge' || nativeValue.endStyle === 'fadeFlat' || nativeValue.endStyle === 'flat'
    ? nativeValue.endStyle
    : 'fadeWedge';
  const starshipConfigPath = typeof starshipValue.configPath === 'string' && starshipValue.configPath.trim()
    ? starshipValue.configPath
    : null;

  const placement: ContextPlacement = value.placement === 'composer' ? 'composer' : 'header';
  const composerLayout: ComposerLayout = value.composerLayout === 'oneLine' ? 'oneLine' : 'twoLine';
  const spacing = typeof value.spacing === 'number' && Number.isFinite(value.spacing)
    ? Math.max(0, Math.min(3, Math.round(value.spacing)))
    : DEFAULT_PROMPT_CONFIGURATION.spacing;
  const gap = typeof value.gap === 'number' && Number.isFinite(value.gap)
    ? Math.max(0, Math.min(3, Math.round(value.gap)))
    : DEFAULT_PROMPT_CONFIGURATION.gap;
  const separator = validSeparator(value.separator) ? value.separator : DEFAULT_PROMPT_CONFIGURATION.separator;

  if (!Array.isArray(value.modules)) {
    return {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), provider, onboardingComplete: value.onboardingComplete === true,
      nmsh: {gapEnabled: typeof nativeValue.gapEnabled === 'boolean' ? nativeValue.gapEnabled : true, endStyle, palette: 'lavender'},
      starship: {configPath: starshipConfigPath}, placement, composerLayout, spacing, gap, separator};
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

  return {provider, onboardingComplete: value.onboardingComplete === true,
    nmsh: {gapEnabled: typeof nativeValue.gapEnabled === 'boolean' ? nativeValue.gapEnabled : true, endStyle, palette: 'lavender'},
    starship: {configPath: starshipConfigPath}, placement, composerLayout, modules, separator, spacing, gap};
}

export function loadPromptConfiguration(path = promptConfigurationPath()): PromptConfiguration {
  try {
    return normalizePromptConfiguration(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  }
}

export function savePromptConfiguration(configuration: PromptConfiguration, path = promptConfigurationPath()): void {
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const normalized = normalizePromptConfiguration(configuration);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  renameSync(temporary, path);
}

export function hasVisibleContextModule(
  configuration: PromptConfiguration,
  context?: {branch?: string; exitStatus?: number},
): boolean {
  return configuration.modules.some(module => module.visible
    && (module.condition !== 'inRepository' || Boolean(context?.branch))
    && (module.condition !== 'nonzeroExit' || (context?.exitStatus ?? 0) !== 0));
}
