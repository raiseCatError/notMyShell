import type {PromptConfiguration} from '../prompt/configuration.js';
import {PROMPT_PROVIDERS} from '../prompt/PromptPanel.js';
import {WELCOME_PROVIDERS} from '../output/WelcomeProviders.js';
import {SUGGESTION_PROVIDERS} from '../suggestions/types.js';
import {HISTORY_PROVIDERS} from '../shell/historyProviders.js';
import {PICKER_PROVIDERS} from '../pickers/Picker.js';
import {NAVIGATION_PROVIDERS} from '../shell/DirectoryService.js';
import type {ProviderDescriptor, ProviderStatus} from './providers.js';

/**
 * Every swappable provider family in one place, over the existing
 * descriptors and the one persisted configuration. /providers, Ask,
 * Settings and Setup Cat all read and write through these accessors, so
 * there is no second provider state. Detection results stay runtime-only.
 */
export type SwitchableFamily = 'prompt' | 'welcome' | 'suggestions' | 'history' | 'picker' | 'navigation';

export interface ProviderFamilyDefinition {
  family: SwitchableFamily;
  title: string;
  providers: readonly ProviderDescriptor[];
  /** The provider used when the selected one is not usable. */
  fallback: string;
  get: (config: PromptConfiguration) => string;
  set: (config: PromptConfiguration, id: string) => PromptConfiguration;
  /** The existing domain panel for deeper configuration, when there is one. */
  settingsDestination?: 'prompt' | 'welcome' | 'suggestions' | 'history' | 'picker' | 'navigation';
}

export const PROVIDER_FAMILIES: readonly ProviderFamilyDefinition[] = [
  {family: 'prompt', title: 'Prompt', providers: PROMPT_PROVIDERS, fallback: 'nmsh', get: config => config.provider,
    set: (config, id) => ({...config, provider: id as PromptConfiguration['provider']})},
  {family: 'welcome', title: 'Welcome', providers: WELCOME_PROVIDERS, fallback: 'vespyr', get: config => config.welcome,
    set: (config, id) => ({...config, welcome: id as PromptConfiguration['welcome']}), settingsDestination: 'welcome'},
  {family: 'suggestions', title: 'Suggestions', providers: SUGGESTION_PROVIDERS, fallback: 'nmsh', get: config => config.suggestions,
    set: (config, id) => ({...config, suggestions: id as PromptConfiguration['suggestions']}), settingsDestination: 'suggestions'},
  {family: 'history', title: 'History', providers: HISTORY_PROVIDERS, fallback: 'native', get: config => config.history,
    set: (config, id) => ({...config, history: id as PromptConfiguration['history']}), settingsDestination: 'history'},
  {family: 'picker', title: 'Picker', providers: PICKER_PROVIDERS, fallback: 'native', get: config => config.picker,
    set: (config, id) => ({...config, picker: id as PromptConfiguration['picker']}), settingsDestination: 'picker'},
  {family: 'navigation', title: 'Directory navigation', providers: NAVIGATION_PROVIDERS, fallback: 'native', get: config => config.navigation,
    set: (config, id) => ({...config, navigation: id as PromptConfiguration['navigation']}), settingsDestination: 'navigation'},
];

export function providerFamily(family: string): ProviderFamilyDefinition | undefined {
  return PROVIDER_FAMILIES.find(item => item.family === family);
}

/** Apply a provider choice through the family's own accessor; unknown ids change nothing. */
export function selectProvider(config: PromptConfiguration, family: string, id: string): PromptConfiguration | undefined {
  const definition = providerFamily(family);
  if (!definition || !definition.providers.some(provider => provider.id === id)) return undefined;
  return definition.set(config, id);
}

export type ProviderRowState = 'active' | 'fallback-active' | 'selected-unavailable' | 'available' | 'installed' | 'missing' | 'unhealthy' | 'builtin';

/**
 * One family's facts: what is configured (preferred), what is actually in
 * use (active, after fallback), and each provider's detection state.
 */
export function familyFacts(definition: ProviderFamilyDefinition, config: PromptConfiguration, statuses: ReadonlyMap<string, ProviderStatus>): {
  preferred: string; active: string; notice?: string;
  rows: Array<{descriptor: ProviderDescriptor; status?: ProviderStatus; preferred: boolean; active: boolean; usable: boolean}>;
} {
  const preferred = definition.get(config);
  const usable = (descriptor: ProviderDescriptor) => descriptor.kind !== 'external' || statuses.get(descriptor.id)?.state === 'installed';
  const selected = definition.providers.find(provider => provider.id === preferred);
  const known = selected && (selected.kind !== 'external' || statuses.has(selected.id));
  // While detection is still running the preference stands; only a known-unusable provider falls back.
  const active = !selected || (known && !usable(selected)) ? definition.fallback : preferred;
  const fallbackLabel = definition.providers.find(provider => provider.id === definition.fallback)?.label ?? definition.fallback;
  const notice = active !== preferred && selected ? `${selected.label} unavailable · using ${fallbackLabel}` : undefined;
  return {preferred, active, ...(notice ? {notice} : {}),
    rows: definition.providers.map(descriptor => ({descriptor, ...(statuses.get(descriptor.id) ? {status: statuses.get(descriptor.id)!} : {}),
      preferred: descriptor.id === preferred, active: descriptor.id === active, usable: usable(descriptor)}))};
}

/** Compact facts for Ask: never more than family, id, label, active and availability. */
export function askProviderFacts(config: PromptConfiguration, statuses: ReadonlyMap<string, ProviderStatus>): Array<{family: string; id: string; label: string; active: boolean; available: boolean}> {
  return PROVIDER_FAMILIES.flatMap(definition => {
    const facts = familyFacts(definition, config, statuses);
    return facts.rows.map(row => ({family: definition.family, id: row.descriptor.id, label: row.descriptor.label, active: row.active,
      available: row.descriptor.kind !== 'external' || row.status?.state === 'installed'}));
  });
}
