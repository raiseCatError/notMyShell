import type {Key} from '../terminal/keys.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import {renderTaskProgress, type TaskProgress} from '../status/TaskProgress.js';
import {providerRowText, providerUsable, type ProviderDescriptor, type ProviderFamily, type ProviderStatus} from './providers.js';

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const RESET = '\u001B[0m';

/**
 * The shared provider gallery: status badges, live preview of the highlighted
 * provider, persisted choice, install only on explicit confirmation, and a
 * factual fallback notice.
 */
export interface ProviderPanelState<Id extends string = string> {
  family: ProviderFamily;
  title: string;
  providers: readonly ProviderDescriptor<Id>[];
  selectedIndex: number;
  saved: Id;
  statuses: Partial<Record<string, ProviderStatus>>;
  step: 'list' | 'installConfirm' | 'installProgress';
  task?: TaskProgress;
  message?: string;
}

export function createProviderPanel<Id extends string>(family: ProviderFamily, title: string,
  providers: readonly ProviderDescriptor<Id>[], saved: Id): ProviderPanelState<Id> {
  return {family, title, providers, saved, statuses: {}, step: 'list',
    selectedIndex: Math.max(0, providers.findIndex(provider => provider.id === saved))};
}

export function providerPanelSelection<Id extends string>(state: ProviderPanelState<Id>): ProviderDescriptor<Id> {
  return state.providers[state.selectedIndex]!;
}

/** What Enter does for the highlighted provider. */
export function providerPanelEnterAction(state: ProviderPanelState): 'save' | 'installConfirm' | 'unavailable' {
  const selected = providerPanelSelection(state);
  if (providerUsable(selected, state.statuses[selected.id])) return 'save';
  return selected.install && state.statuses[selected.id]?.state === 'missing' ? 'installConfirm' : 'unavailable';
}

export function handleProviderPanelKey(key: Key, state: ProviderPanelState): boolean {
  if (state.step !== 'list') return false;
  const count = state.providers.length;
  if (key.kind === 'up') state.selectedIndex = (state.selectedIndex - 1 + count) % count;
  else if (key.kind === 'down') state.selectedIndex = (state.selectedIndex + 1) % count;
  else return false;
  state.message = undefined;
  return true;
}

/** `preview` is the highlighted provider rendered by its family; the panel never invents content. */
export function renderProviderPanel(state: ProviderPanelState, columns: number, preview: readonly string[], rowsAvailable = Infinity): string[] {
  const savedLabel = state.providers.find(provider => provider.id === state.saved)?.label ?? state.saved;
  const rows = [`${PRIMARY}  ${state.title}${RESET}`, `${SUBTLE}  Current  ${SECONDARY}${savedLabel}${RESET}`, ''];
  const selected = providerPanelSelection(state);
  if (state.step === 'installConfirm') {
    rows.push(`${PRIMARY}Install ${selected.label}?${RESET}`, `${SECONDARY}Runs: ${selected.install?.label ?? ''}${RESET}`, '',
      renderControls([['Enter', 'install'], ['Esc', 'back']]));
    return rows.map(row => truncateAnsi(row, columns));
  }
  if (state.step === 'installProgress') {
    rows.push(...(state.task ? renderTaskProgress(state.task.state) : []));
    return rows.map(row => truncateAnsi(row, columns));
  }
  state.providers.forEach((provider, index) => {
    const active = index === state.selectedIndex;
    rows.push(`${active ? ACCENT : SECONDARY}${active ? '›' : ' '} ${providerRowText(provider,
      {draft: selected.id, saved: state.saved, status: state.statuses[provider.id]})}${RESET}`);
  });
  const footer = [
    ...(state.message ? ['', `${SECONDARY}${state.message}${RESET}`] : []),
    '', renderControls([['↑↓', 'preview'], ['Enter', 'use'], ['Esc', 'cancel']]),
  ];
  const budget = Math.max(0, rowsAvailable - rows.length - footer.length - 2);
  if (preview.length > 0 && budget > 0) {
    rows.push('', `${PRIMARY}Preview${RESET}  ${SUBTLE}${selected.label}${RESET}`, ...preview.slice(0, budget));
  }
  return [...rows, ...footer].map(row => truncateAnsi(row, columns));
}
