import type {Key} from '../terminal/keys.js';
import type {PromptConfiguration} from '../prompt/configuration.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi, truncateText} from '../util/text.js';
import {familyFacts, PROVIDER_FAMILIES, type SwitchableFamily} from './families.js';
import type {ProviderStatus} from './providers.js';

/**
 * /providers: one overview of everything NMSh uses through a provider, what
 * else is available, installed or missing, and the way into each family's
 * existing panel. It reads the one configuration and runtime detection; it
 * owns no provider state of its own.
 */
export type OverviewRowId = SwitchableFamily | 'understanding' | 'shell';

export interface ProvidersOverviewState {
  selected: number;
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

export type OverviewAction = {kind: 'close'} | {kind: 'open'; row: OverviewRowId} | {kind: 'detect'};

export const OVERVIEW_ROWS: readonly OverviewRowId[] = [...PROVIDER_FAMILIES.map(family => family.family), 'understanding', 'shell'];

export function createProvidersOverview(): ProvidersOverviewState {
  return {selected: 0, detecting: true};
}

export function providersOverviewKey(state: ProvidersOverviewState, key: Key): OverviewAction | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') {
    state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + OVERVIEW_ROWS.length) % OVERVIEW_ROWS.length;
    state.message = undefined;
    return undefined;
  }
  if (key.kind === 'enter') return {kind: 'open', row: OVERVIEW_ROWS[state.selected]!};
  if (key.kind === 'text' && key.value.toLowerCase() === 'r') return {kind: 'detect'};
  return undefined;
}

/** One provider's factual state in words, never by color alone. */
export function providerStateText(kind: string, status: ProviderStatus | undefined, nmshInstalled: boolean): string {
  if (kind === 'native') return 'Built in';
  if (kind === 'none') return 'Off';
  if (!status) return 'Checking…';
  if (status.state === 'installed') return `Installed${status.version ? ` ${status.version}` : ''} · ${nmshInstalled ? 'installed by NMSh' : 'found on this system'}`;
  if (status.state === 'missing') return 'Not installed';
  return `Unavailable${status.detail ? ` · ${status.detail}` : ''}`;
}

export function renderProvidersOverview(state: ProvidersOverviewState, facts: OverviewFacts, columns: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const rows = [`${primary}  Providers${reset}  ${subtle}what NMSh uses, what else is available · [active] is in use, ${GLYPHS.selection} is the selected row${reset}`, ''];
  const nameWidth = 20;
  const line = (index: number, title: string, active: string, tag: string) => {
    const selected = index === state.selected;
    return `${selected ? `${accent}${GLYPHS.selection}` : ' '} ${selected ? primary : secondary}${title.padEnd(nameWidth)}${reset}${primary}${truncateText(active, 28).padEnd(28)}${reset}  ${subtle}${tag}${reset}`;
  };
  PROVIDER_FAMILIES.forEach((definition, index) => {
    const familyState = familyFacts(definition, facts.configuration, facts.statuses);
    const active = definition.providers.find(provider => provider.id === familyState.active)!;
    rows.push(line(index, definition.title, active.label, familyState.notice ? `[active] fallback · ${familyState.notice}` : '[active]'));
    if (index === state.selected) {
      for (const row of familyState.rows) {
        const marks = [row.active ? '[active]' : '', row.preferred && !row.active ? '[preferred]' : ''].filter(Boolean).join(' ');
        const status = providerStateText(row.descriptor.kind, row.status, facts.installedByNmsh.has(row.descriptor.executable ?? row.descriptor.id));
        rows.push(`      ${secondary}${row.descriptor.label.padEnd(18)}${reset} ${subtle}${status}${marks ? `  ${marks}` : ''}${row.status?.binary ? `  ${row.status.binary}` : ''}${reset}`);
      }
    }
  });
  const understandingIndex = PROVIDER_FAMILIES.length;
  rows.push(line(understandingIndex, 'Local understanding', facts.understanding.active, '[active]'));
  if (state.selected === understandingIndex) for (const detail of facts.understanding.detail) rows.push(`      ${subtle}${detail}${reset}`);
  rows.push(line(understandingIndex + 1, 'Shell', `${facts.shell.current} (this session)`, `default ${facts.shell.defaultShell} · managed in /shell`));
  rows.push('', `  ${subtle}Enter opens the family: switch, install (previewed, starts on No), configure. Uninstall of what NMSh installed is in /tools.${reset}`);
  if (state.detecting) rows.push(`  ${subtle}Detecting installed providers…${reset}`);
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['Enter', 'open'], ['R', 'detect again'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}

