import type {ProviderDescriptor} from '../providers/providers.js';
export type HistoryProviderId = 'native' | 'atuin';
export const HISTORY_PROVIDERS: readonly ProviderDescriptor<HistoryProviderId>[] = [
  {id: 'native', family: 'history', label: 'NMSh Native', kind: 'native', description: 'shell-approved journals and zsh history'},
  {id: 'atuin', family: 'history', label: 'Atuin', kind: 'external', executable: 'atuin', versionArgs: ['--version'],
    description: 'read your local Atuin history; no recording or sync', setup: 'NMSh never invokes sync or changes your existing zsh hooks.',
    recipe: {brew: 'atuin'}, source: 'https://atuin.sh/'},
];
export const ATUIN_METADATA_FORMAT = 'nmsh-v1\u001f{uuid}\u001f{time}\u001f{exit}\u001f{directory}\u001f{duration}\u001f{session}\u001f{command}';
