import {StarshipConfigAdapter, STARSHIP_MODULES} from '../prompt/StarshipConfigAdapter.js';
import {detectStarship} from '../prompt/starship.js';

export interface SupportedField {id: string; label: string; description: string}
/** Prepared bytes stay in the adapter. Only supported values reach presentation. */
export interface ConfigReview {preview: readonly string[]; apply(): Promise<void>}
export interface SupportedConfiguration {
  id: string;
  label: string;
  fields: readonly SupportedField[];
  read(): Promise<Readonly<Record<string, boolean>>>;
  prepare(field: string, value: boolean): Promise<ConfigReview>;
}

export const SUPPORTED_CONFIGURATIONS = [{id: 'starship', label: 'Starship modules'}] as const;

/** Native config CLI first; no discovered tool or arbitrary path gains write authority. */
export async function openSupportedConfiguration(id: string, env: NodeJS.ProcessEnv = process.env): Promise<SupportedConfiguration> {
  if (id !== 'starship') throw new Error('No supported configuration adapter.');
  const native = new StarshipConfigAdapter(await detectStarship(env));
  return {
    id, label: 'Starship modules',
    fields: STARSHIP_MODULES.map(id => ({id, label: id, description: `Show the ${id} module in Starship's prompt.`})),
    read: async () => Object.fromEntries(await Promise.all(STARSHIP_MODULES.map(async id => [id, !await native.disabled(id)]))),
    prepare: async (field, value) => {
      const module = STARSHIP_MODULES.find(id => id === field);
      if (!module || typeof value !== 'boolean') throw new Error('Unsupported configuration value.');
      const proposal = await native.propose(module, !value);
      return {preview: [`${module}: ${value ? 'Enabled' : 'Disabled'}`, ...proposal.diff,
        'Existing config is backed up; unknown settings must remain unchanged.'],
      apply: async () => { await native.apply(proposal); }};
    },
  };
}
