import type {Key} from '../terminal/keys.js';
import type {PromptConfiguration} from '../prompt/configuration.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {COLUMN_GUTTER, labelColumnWidth, padCells, truncateAnsi, truncateText} from '../util/text.js';
import {familyFacts, providerFamily, PROVIDER_FAMILIES, type SwitchableFamily} from './families.js';
import {providerInstall, type ProviderStatus} from './providers.js';

/**
 * /providers: the one provider control surface. Every family is a row;
 * Enter expands its providers inline in the same panel (never a second
 * screen), Enter on a usable provider selects it at once, and Enter on a
 * missing installable one opens an inline install confirmation (default No).
 * It reads the one configuration and runtime detection; it owns no provider
 * state of its own.
 */
export type OverviewRowId = SwitchableFamily | 'understanding' | 'shell';

export interface ProvidersOverviewState {
  selected: number;
  expanded?: OverviewRowId;
  /** Inline install confirmation under a provider row. */
  confirm?: {family: SwitchableFamily; id: string; yes: boolean};
  /** An install running inline. */
  installing?: {family: SwitchableFamily; id: string; line: string};
  /** Detection still running. */
  detecting: boolean;
  message?: string;
}

export interface OverviewFacts {
  configuration: PromptConfiguration;
  statuses: ReadonlyMap<string, ProviderStatus>;
  /** Provider ids NMSh installed itself (install provenance); everything else was found. */
  installedByNmsh: ReadonlySet<string>;
  /** Local understanding summary rows, from the shared model service. */
  understanding: {active: string; detail: string[]};
  shell: {current: string; defaultShell: string};
}

export type OverviewAction =
  | {kind: 'close'} | {kind: 'detect'}
  | {kind: 'open'; row: OverviewRowId}
  | {kind: 'select'; family: SwitchableFamily; id: string}
  | {kind: 'install'; family: SwitchableFamily; id: string};

export const OVERVIEW_ROWS: readonly OverviewRowId[] = [...PROVIDER_FAMILIES.map(family => family.family), 'understanding', 'shell'];

type Item = {kind: 'family'; row: OverviewRowId} | {kind: 'provider'; family: SwitchableFamily; id: string} | {kind: 'configure'; family: 'prompt'};

export function createProvidersOverview(focus?: SwitchableFamily): ProvidersOverviewState {
  const state: ProvidersOverviewState = {selected: 0, detecting: true};
  if (focus) { state.expanded = focus; state.selected = OVERVIEW_ROWS.indexOf(focus); }
  return state;
}

export function overviewItems(state: ProvidersOverviewState): Item[] {
  const items: Item[] = [];
  for (const row of OVERVIEW_ROWS) {
    items.push({kind: 'family', row});
    const definition = providerFamily(row);
    if (state.expanded !== row || !definition) continue;
    for (const provider of definition.providers) items.push({kind: 'provider', family: definition.family, id: provider.id});
    if (row === 'prompt') items.push({kind: 'configure', family: 'prompt'});
  }
  return items;
}

/** One provider's state in words and a glyph, never color alone. */
export function providerStatusLabel(row: ReturnType<typeof familyFacts>['rows'][number], fallbackLabel: string): string {
  const kind = row.descriptor.kind;
  if (row.active) return '● Active';
  if (row.preferred) return `✓ Selected · fallback → ${fallbackLabel}`;
  if (kind === 'native') return 'Built in';
  if (kind === 'none') return 'Off';
  if (!row.status) return 'Checking…';
  if (row.status.state === 'installed') return `Available${row.status.version ? ` · ${row.status.version}` : ''}`;
  if (row.status.state === 'missing') return providerInstall(row.descriptor) ? 'Missing · Enter to install' : 'Missing';
  return `Unavailable${row.status.detail ? ` · ${row.status.detail}` : ''}`;
}

/** Kept for callers that only need the install provenance wording. */
export function providerStateText(kind: string, status: ProviderStatus | undefined, nmshInstalled: boolean): string {
  if (kind === 'native') return 'Built in';
  if (kind === 'none') return 'Off';
  if (!status) return 'Checking…';
  if (status.state === 'installed') return `Installed${status.version ? ` ${status.version}` : ''} · ${nmshInstalled ? 'installed by NMSh' : 'found on this system'}`;
  if (status.state === 'missing') return 'Not installed';
  return `Unavailable${status.detail ? ` · ${status.detail}` : ''}`;
}

export function providersOverviewKey(state: ProvidersOverviewState, key: Key, facts?: Pick<OverviewFacts, 'configuration' | 'statuses'>): OverviewAction | undefined {
  if (state.installing) return undefined;
  if (state.confirm) {
    if (key.kind === 'left' || key.kind === 'right') { state.confirm.yes = !state.confirm.yes; return undefined; }
    if (key.kind === 'enter') {
      const {family, id, yes} = state.confirm;
      state.confirm = undefined;
      if (yes) return {kind: 'install', family, id};
      state.message = 'Nothing was installed.';
      return undefined;
    }
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.confirm = undefined; state.message = 'Nothing was installed.'; }
    return undefined;
  }
  const items = overviewItems(state);
  state.selected = Math.max(0, Math.min(state.selected, items.length - 1));
  const item = items[state.selected]!;
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    // Esc collapses the expanded family first; it closes only when nothing is expanded.
    if (state.expanded) {
      const row = state.expanded;
      state.expanded = undefined;
      state.selected = OVERVIEW_ROWS.indexOf(row);
      return undefined;
    }
    return {kind: 'close'};
  }
  if (key.kind === 'up' || key.kind === 'down') {
    state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + items.length) % items.length;
    state.message = undefined;
    return undefined;
  }
  if (key.kind === 'text' && key.value.toLowerCase() === 'r') return {kind: 'detect'};
  if (key.kind !== 'enter' && !(key.kind === 'text' && key.value === ' ')) return undefined;
  if (item.kind === 'family') {
    if (item.row === 'understanding' || item.row === 'shell') return {kind: 'open', row: item.row};
    state.expanded = state.expanded === item.row ? undefined : item.row;
    state.selected = overviewItems(state).findIndex(entry => entry.kind === 'family' && entry.row === item.row);
    return undefined;
  }
  if (item.kind === 'configure') return {kind: 'open', row: 'prompt'};
  const definition = providerFamily(item.family)!;
  const descriptor = definition.providers.find(provider => provider.id === item.id)!;
  const status = facts?.statuses.get(descriptor.id);
  if (descriptor.kind === 'external' && status?.state === 'missing') {
    if (providerInstall(descriptor)) state.confirm = {family: item.family, id: item.id, yes: false};
    else state.message = `${descriptor.label} is not installed and NMSh has no verified install recipe for it here.`;
    return undefined;
  }
  if (descriptor.kind === 'external' && status && status.state !== 'installed') { state.message = `${descriptor.label} is unavailable${status.detail ? `: ${status.detail}` : ''}.`; return undefined; }
  return {kind: 'select', family: item.family, id: item.id};
}

export function renderProvidersOverview(state: ProvidersOverviewState, facts: OverviewFacts, columns: number, height = Infinity): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const items = overviewItems(state);
  const selected = Math.max(0, Math.min(state.selected, items.length - 1));
  const lines: Array<{text: string; item?: number}> = [{text: `${primary}  Providers${reset}  ${subtle}what NMSh uses for each job · Enter expands a family and selects a provider${reset}`}, {text: ''}];
  const nameWidth = labelColumnWidth([...PROVIDER_FAMILIES.map(family => family.title), 'Local understanding'], columns, 2, 30);
  const activeWidth = Math.max(8, Math.min(28, columns - 2 - nameWidth - 2 * COLUMN_GUTTER - 8));
  const mark = (index: number) => index === selected ? `${accent}${GLYPHS.selection}${reset}` : ' ';
  items.forEach((item, index) => {
    const isSelected = index === selected;
    if (item.kind === 'family') {
      const expander = item.row === 'understanding' || item.row === 'shell' ? ' ' : state.expanded === item.row ? '▾' : '▸';
      const definition = providerFamily(item.row);
      if (definition) {
        const familyState = familyFacts(definition, facts.configuration, facts.statuses);
        const active = definition.providers.find(provider => provider.id === familyState.active)!;
        const preferred = definition.providers.find(provider => provider.id === familyState.preferred);
        const tag = familyState.notice ? `Selected ${preferred?.label ?? familyState.preferred} · fallback → ${active.label}` : '● Active';
        lines.push({item: index, text: `${mark(index)} ${subtle}${expander}${reset} ${focusForeground(isSelected)}${padCells(definition.title, nameWidth)}${reset}${primary}${padCells(truncateText(active.label, activeWidth), activeWidth)}${reset}${subtle}${tag}${reset}`});
      } else if (item.row === 'understanding') {
        lines.push({item: index, text: `${mark(index)}   ${focusForeground(isSelected)}${padCells('Local understanding', nameWidth)}${reset}${primary}${padCells(truncateText(facts.understanding.active, activeWidth), activeWidth)}${reset}${subtle}Enter opens it${reset}`});
        if (isSelected) for (const detail of facts.understanding.detail) lines.push({text: `        ${subtle}${detail}${reset}`});
      } else {
        lines.push({item: index, text: `${mark(index)}   ${focusForeground(isSelected)}${padCells('Shell', nameWidth)}${reset}${primary}${padCells(`${facts.shell.current} (this session)`, activeWidth)}${reset}${subtle}default ${facts.shell.defaultShell} · Enter opens /shell${reset}`});
      }
      return;
    }
    if (item.kind === 'configure') {
      lines.push({item: index, text: `${mark(index)}     ${isSelected ? accent : subtle}Configure the prompt (themes, styles, modules) in /prompt ›${reset}`});
      return;
    }
    const definition = providerFamily(item.family)!;
    const familyState = familyFacts(definition, facts.configuration, facts.statuses);
    const row = familyState.rows.find(entry => entry.descriptor.id === item.id)!;
    const fallbackLabel = definition.providers.find(provider => provider.id === definition.fallback)?.label ?? definition.fallback;
    const providerWidth = labelColumnWidth(familyState.rows.map(entry => entry.descriptor.label), columns, 6, 16);
    const description = row.descriptor.kind === 'external' && row.status?.binary ? row.status.binary : row.descriptor.description;
    lines.push({item: index, text: `${mark(index)}     ${focusForeground(isSelected)}${padCells(row.descriptor.label, providerWidth)}${reset}${row.active ? accent : subtle}${padCells(providerStatusLabel(row, fallbackLabel), 38)}${reset}${subtle}${truncateText(description, 40)}${reset}`});
    if (state.confirm && state.confirm.family === item.family && state.confirm.id === item.id) {
      const install = providerInstall(row.descriptor)!;
      lines.push({text: `        ${primary}Install with: ${install.label}${reset}`});
      lines.push({text: `        ${primary}Install now?${reset}  ${state.confirm.yes ? `${subtle}No${reset}  ${accent}‹ Yes ›${reset}` : `${accent}‹ No ›${reset}  ${subtle}Yes${reset}`}  ${subtle}←→ choose · Enter confirm · Esc cancel${reset}`});
    }
    if (state.installing && state.installing.family === item.family && state.installing.id === item.id) lines.push({text: `        ${subtle}${state.installing.line}${reset}`});
  });
  lines.push({text: ''}, {text: `  ${subtle}Selecting applies at once. Installs are shown first and start on No; uninstall of what NMSh installed is in /tools.${reset}`});
  if (state.detecting) lines.push({text: `  ${subtle}Detecting installed providers…${reset}`});
  if (state.message) lines.push({text: ''}, {text: `  ${secondary}${state.message}${reset}`});
  const controls = renderControls([['↑↓', 'select'], ['Enter', state.expanded ? 'select / collapse' : 'expand'], ['R', 'detect again'], ['Esc', state.expanded ? 'collapse' : 'close']]);
  const budget = Number.isFinite(height) ? Math.max(3, height - 2) : lines.length;
  const at = Math.max(0, lines.findIndex(line => line.item === selected));
  const start = lines.length <= budget ? 0 : Math.max(0, Math.min(at - Math.floor(budget / 2), lines.length - budget));
  return [...lines.slice(start, start + budget).map(line => line.text), '', controls].map(row => truncateAnsi(row, columns));
}
