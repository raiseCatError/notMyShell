import type {Key} from '../terminal/keys.js';
import {clearProviderDetection, detectProvider, type ProviderStatus, type ProviderInstall} from '../providers/providers.js';
import {TaskProgress, renderTaskProgress} from '../status/TaskProgress.js';
import {createConfirm, editText, handleConfirmKey, renderConfirm, type ConfirmState} from '../ui/formControls.js';
import {renderTabStrip, framePanel} from '../ui/PanelShell.js';
import {colorLevel} from '../presentation/capabilities.js';
import {foregroundOf} from '../chroma/chroma.js';
import {languageIdentity} from '../languages/linguistLanguageColors.js';
import {displayWidth, stripAnsi, truncateAnsi, truncateText} from '../util/text.js';
import {TOOLS, TOOL_CATEGORIES, TOOL_TIER_LABELS, toolInstall, toolInstallUnavailable, type Tool, type ToolTier} from './catalog.js';
import {lifecycleNote, providerLifecycle} from '../providers/providers.js';
import {toolOwner, toolUpgrade, UNKNOWN_OWNER_UPDATE, type ToolUpdateState} from './ToolUpdates.js';
import {background, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {renderControls} from '../ui/controls.js';

export type ToolsTab = 'discover' | 'installed' | 'configure' | 'errors';
const TABS: readonly ToolsTab[] = ['discover', 'installed', 'configure', 'errors'];
export interface ToolsPanel {
  tab: ToolsTab; query: string; selected: number; statuses: Record<string, ProviderStatus>;
  errors: Record<string, string>; configured: ReadonlySet<string>; recommendedOnly: boolean;
  detail?: Tool; recipe?: ProviderInstall; confirm?: ConfirmState; task?: TaskProgress;
  message?: string; onboarding?: number;
  /** Discover filter: only Recommended, or Recommended + Enhanced. */
  tier?: ToolTier;
  /** Last optional update check; absent until one ran. */
  updates?: ToolUpdateState;
  /** The pending confirmation is an upgrade, not an install. */
  upgrading?: boolean;
  /** An explicit update check is running. */
  checking?: boolean;
}
export const ONBOARDING_CHOICES = ['Recommended', 'Recommended + Enhanced', 'Choose individually', 'Skip'] as const;
const SKIP = ONBOARDING_CHOICES.length - 1;
export function createToolsPanel(configured: ReadonlySet<string> = new Set(), onboarding = false): ToolsPanel {
  return {tab: 'discover', query: '', selected: 0, statuses: {}, errors: {}, configured,
    recommendedOnly: false, ...(onboarding ? {onboarding: SKIP} : {})};
}
export async function refreshTools(state: ToolsPanel, changed: () => void): Promise<void> {
  clearProviderDetection();
  // Bound probes rather than spawning the whole catalog simultaneously.
  for (let index = 0; index < TOOLS.length; index += 3) {
    await Promise.all(TOOLS.slice(index, index + 3).map(async tool => {
      state.statuses[tool.id] = await detectProvider(tool);
    }));
    changed();
  }
}
export function visibleTools(state: ToolsPanel): Tool[] {
  const query = state.query.trim().toLowerCase();
  const tier = state.tier ?? (state.recommendedOnly ? 'recommended' : undefined);
  return TOOLS.filter(tool => (state.tab !== 'discover' || !tier || tool.tier === 'recommended' || (tier === 'enhanced' && tool.tier === 'enhanced'))
    && (!query || `${tool.label} ${tool.description} ${tool.category}`.toLowerCase().includes(query))
    && (state.tab !== 'installed' || state.statuses[tool.id]?.state === 'installed')
    && (state.tab !== 'configure' || !!tool.configuration)
    && (state.tab !== 'errors' || !!state.errors[tool.id] || (state.configured.has(tool.id) && state.statuses[tool.id]?.state === 'missing')))
    .sort((a, b) => TOOL_CATEGORIES.indexOf(a.category) - TOOL_CATEGORIES.indexOf(b.category)
      || Number(state.statuses[a.id]?.state === 'installed') - Number(state.statuses[b.id]?.state === 'installed') || a.label.localeCompare(b.label));
}
export type ToolsAction = 'close' | 'configure' | 'provider' | 'refresh' | 'finishOnboarding' | 'mise' | 'checkUpdates';

/** Whether an installed tool has an update according to the last check. */
export function toolHasUpdate(state: ToolsPanel, tool: Tool): boolean {
  return Boolean(tool.package && state.updates?.outdated[tool.package] && state.statuses[tool.id]?.state === 'installed');
}
/** No key handler installs until a separate reviewed confirmation. */
export function toolsKey(state: ToolsPanel, key: Key): ToolsAction | undefined {
  if (state.task?.state.status === 'running') return undefined;
  if (state.onboarding !== undefined) {
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.onboarding = undefined; return 'close'; }
    const count = ONBOARDING_CHOICES.length;
    if (key.kind === 'up' || key.kind === 'down') state.onboarding = (state.onboarding + (key.kind === 'up' ? count - 1 : 1)) % count;
    if (key.kind === 'enter') {
      const choice = state.onboarding; state.onboarding = undefined;
      state.recommendedOnly = choice === 0;
      state.tier = choice === 0 ? 'recommended' : choice === 1 ? 'enhanced' : undefined;
      if (choice === SKIP) return 'close';
      return 'finishOnboarding';
    }
    return undefined;
  }
  if (state.confirm) return undefined; // Async install owner handles confirmation.
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (state.detail) { state.detail = undefined; state.message = undefined; }
    else if (state.query) { state.query = ''; state.selected = 0; }
    else return 'close';
  } else if (state.detail) {
    if (key.kind !== 'text') return undefined;
    if (key.value.toLowerCase() === 'm' && state.detail.id === 'mise') return 'mise';
    if (key.value.toLowerCase() === 'u' && toolHasUpdate(state, state.detail)) {
      const upgrade = toolUpgrade(state.detail, toolOwner(state.statuses[state.detail.id]?.binary), state.updates!);
      if (upgrade) { state.recipe = upgrade; state.upgrading = true; state.confirm = createConfirm(); }
      else state.message = `${UNKNOWN_OWNER_UPDATE} NMSh did not install ${state.detail.label} and does not guess its package manager.`;
      return undefined;
    }
    if (key.value.toLowerCase() === 'i' && state.statuses[state.detail.id]?.state === 'missing') {
      state.recipe = toolInstall(state.detail);
      if (state.recipe) state.confirm = createConfirm();
      else state.message = `${toolInstallUnavailable(state.detail)} Nothing was installed.`;
    } else if (key.value.toLowerCase() === 'c' && state.detail.configuration && state.statuses[state.detail.id]?.state === 'installed') return 'configure';
    else if (key.value.toLowerCase() === 'p' && state.detail.providerFamily) return 'provider';
    else if (key.value.toLowerCase() === 'r') return 'refresh';
  } else if (key.kind === 'left' || key.kind === 'right') {
    const index = TABS.indexOf(state.tab);
    state.tab = TABS[(index + (key.kind === 'left' ? 3 : 1)) % TABS.length]!;
    state.selected = 0;
  } else if (key.kind === 'up' || key.kind === 'down') {
    state.selected = Math.max(0, Math.min(visibleTools(state).length - 1, state.selected + (key.kind === 'up' ? -1 : 1)));
  } else if (key.kind === 'enter') state.detail = visibleTools(state)[state.selected];
  else if (key.kind === 'text' && key.value === 'U' && !state.query) return 'checkUpdates';
  else {
    const next = editText(state.query, key);
    if (next !== undefined) { state.query = next; state.selected = 0; }
  }
  return undefined;
}

export async function confirmToolInstall(state: ToolsPanel, key: Key, changed: () => void,
  run?: (task: TaskProgress, recipe: ProviderInstall) => Promise<void>): Promise<void> {
  if (!state.confirm || !state.recipe || !state.detail) return;
  const decision = handleConfirmKey(key.kind === 'interrupt' ? {kind: 'escape'} : key, state.confirm);
  if (decision === 'cancel') { state.confirm = undefined; state.recipe = undefined; return; }
  if (decision !== 'confirm') return;
  const recipe = state.recipe;
  const tool = state.detail;
  const upgrading = state.upgrading === true;
  state.confirm = undefined; state.recipe = undefined; state.upgrading = undefined;
  const task = state.task = new TaskProgress(`${upgrading ? 'Upgrading' : 'Installing'} ${tool.label}`, changed, Date.now(), tool.label);
  if (run) await run(task, recipe);
  else await task.run(recipe.command, [...recipe.args]);
  clearProviderDetection();
  state.statuses[tool.id] = await detectProvider(tool);
  if (task.state.status === 'succeeded' && state.statuses[tool.id]?.state === 'installed') {
    delete state.errors[tool.id];
    if (upgrading && state.updates && tool.package) {
      const {[tool.package]: _upgraded, ...rest} = state.updates.outdated;
      state.updates = {...state.updates, outdated: rest};
    }
    state.message = `${tool.label} ${upgrading ? 'upgraded' : 'installed'}. Shell hooks/settings were not changed.`;
  } else {
    state.errors[tool.id] = task.state.status === 'failed' ? `${upgrading ? 'Upgrade' : 'Installation'} failed: ${task.state.error ?? 'unknown error'}` : 'Package manager finished; executable was not detected.';
    state.message = state.errors[tool.id];
  }
  changed();
}
function statusText(state: ToolsPanel, tool: Tool): string {
  const status = state.statuses[tool.id];
  if (!status) return 'Checking';
  return status.state === 'installed' ? (state.configured.has(tool.id) ? 'Installed / Configured in NMSh' : 'Installed')
    : status.state === 'missing' ? 'Missing' : 'Needs attention';
}

// Resolved per render so color capability changes (NO_COLOR, NMSH_COLOR) apply immediately.
let PRIMARY = '', SECONDARY = '', SUBTLE = '', ACCENT = '', SUCCESS = '', FAILURE = '', SELECTED = '';
function resolveColors(): void {
  PRIMARY = foreground(UI_COLORS.primary); SECONDARY = foreground(UI_COLORS.secondary); SUBTLE = foreground(UI_COLORS.subtle);
  ACCENT = foreground(UI_COLORS.accent); SUCCESS = foreground(UI_COLORS.success); FAILURE = foreground(UI_COLORS.failure);
  SELECTED = background(UI_COLORS.selection);
}
const RESET = '\u001b[0m';

/** Status badge: a glyph plus a word, so meaning never depends on color alone. */
function statusBadge(state: ToolsPanel, tool: Tool): {text: string; color: string} {
  const status = state.statuses[tool.id];
  const nerd = getCurrentGlyphMode() === 'nerd';
  if (!status) return {text: `${nerd ? '…' : '.'} Checking`, color: SUBTLE};
  if (status.state === 'installed') return {text: `${nerd ? '●' : '*'} Installed`, color: SUCCESS};
  if (status.state === 'missing') return {text: `${nerd ? '○' : 'o'} Missing`, color: SUBTLE};
  return {text: '! Needs attention', color: FAILURE};
}

function tags(state: ToolsPanel, tool: Tool): string[] {
  const lifecycle = providerLifecycle(tool);
  return [...(tool.tier ? [TOOL_TIER_LABELS[tool.tier].replace(' CLI', '')] : []), ...(state.configured.has(tool.id) ? ['Configured in NMSh'] : []),
    ...(toolHasUpdate(state, tool) ? ['Update available'] : []),
    ...(lifecycle === 'legacy' ? ['Legacy'] : lifecycle === 'maintenance' ? ['Maintenance'] : []),
    ...(state.errors[tool.id] ? ['Error'] : [])];
}

/** One aligned tool row; the selected row gets the shared selection background, a pointer and a bright label. */
function toolRow(state: ToolsPanel, tool: Tool, selected: boolean, columns: number): string {
  const badge = statusBadge(state, tool);
  const labelWidth = columns >= 60 ? 22 : Math.max(8, columns - 18);
  const label = truncateText(tool.label, labelWidth - 1).padEnd(labelWidth);
  const pointer = selected ? `${ACCENT}${GLYPHS.selection}` : ' ';
  const status = columns >= 34 ? `${badge.color}${badge.text.padEnd(18)}` : `${badge.color}${badge.text.slice(0, 1)} `;
  const extra = columns >= 60 ? `${selected ? SECONDARY : SUBTLE}${tags(state, tool).join(' · ')}` : '';
  const row = `  ${pointer} ${selected ? `${BOLD}${PRIMARY}` : SECONDARY}${label}${RESET}${selected ? SELECTED : ''}${status}${extra}`;
  if (!selected) return truncateAnsi(`${row}${RESET}`, columns);
  // Fill the whole row so the selection reads as a band, not just colored text.
  const plain = truncateAnsi(row, columns);
  return `${SELECTED}${plain}${SELECTED}${' '.repeat(Math.max(0, columns - displayWidth(plain)))}${RESET}`;
}

const BOLD = '\u001b[1m';

/** Category headers and tool rows in display order; headers are not selectable. */
function groupedRows(tools: readonly Tool[]): Array<{kind: 'header'; category: string} | {kind: 'tool'; tool: Tool; index: number}> {
  const rows: Array<{kind: 'header'; category: string} | {kind: 'tool'; tool: Tool; index: number}> = [];
  tools.forEach((tool, index) => {
    if (index === 0 || tools[index - 1]!.category !== tool.category) rows.push({kind: 'header', category: tool.category});
    rows.push({kind: 'tool', tool, index});
  });
  return rows;
}

export function renderTools(state: ToolsPanel, columns: number, height: number): string[] {
  resolveColors();
  const tabsRow = renderTabStrip(['Discover', 'Installed', 'Configure', 'Errors'], TABS.indexOf(state.tab), columns);
  const rows: string[] = [`${PRIMARY}  Tools${RESET}  ${SUBTLE}optional · NMSh is complete without them; switch providers anytime${RESET}`, tabsRow, ''];
  let footer: Array<[string, string]> = [['↑↓', 'select'], ['←→', 'tabs'], ['Enter', 'details'], ['type', 'search'], ['U', 'check updates'], ['Esc', state.query ? 'clear search' : 'close']];
  if (state.onboarding !== undefined) {
    rows.push(`${PRIMARY}  NMSh is complete out of the box. No external shell tools are required.${RESET}`,
      `${SUBTLE}  Optional tools can be added now or later; browsing changes nothing and each install asks first.${RESET}`,
      `${SUBTLE}  Run /setup anytime to revisit these choices.${RESET}`, '',
      ...ONBOARDING_CHOICES.map((label, i) => i === state.onboarding
        ? `  ${ACCENT}${GLYPHS.selection} ${PRIMARY}${label}${RESET}` : `    ${SECONDARY}${label}${RESET}`));
    footer = [['↑↓', 'choose'], ['Enter', 'continue'], ['Esc', 'skip']];
  } else if (state.confirm) {
    rows.push(`${PRIMARY}  ${state.upgrading ? 'Upgrade' : 'Install'} ${state.detail?.label ?? 'tool'}?${RESET}`, '', `  ${SUBTLE}Runs${RESET}  ${PRIMARY}${state.recipe?.label ?? ''}${RESET}`,
      `  ${SUBTLE}Changes installed software only; shell hooks and settings are not touched.${RESET}`, '',
      `  ${renderConfirm(state.confirm, {focused: true, color: colorLevel() !== 'none'})}`);
    footer = [['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']];
  } else if (state.task?.state.status === 'running') {
    rows.push(...renderTaskProgress(state.task.state));
    footer = [['Please wait', 'installation in progress']];
  } else if (state.detail) {
    const tool = state.detail;
    const badge = statusBadge(state, tool);
    const field = (label: string, value: string) => `  ${SUBTLE}${label.padEnd(10)}${RESET}${SECONDARY}${value}${RESET}`;
    rows.push(`  ${PRIMARY}${BOLD}${tool.label}${RESET}  ${badge.color}${badge.text}${RESET}${tags(state, tool).length ? `  ${SUBTLE}${tags(state, tool).join(' · ')}${RESET}` : ''}`,
      `  ${SUBTLE}${tool.description}${RESET}`, '',
      field('Category', tool.category), field('Source', tool.source),
      field('Install', state.statuses[tool.id]?.state === 'missing'
        ? toolInstall(tool)?.label ?? toolInstallUnavailable(tool) : tool.package ? `Homebrew formula ${tool.package}` : 'Installed outside NMSh'));
    const lifecycle = lifecycleNote(tool);
    if (lifecycle) rows.push(field('Lifecycle', lifecycle));
    const outdated = tool.package ? state.updates?.outdated[tool.package] : undefined;
    if (outdated && state.statuses[tool.id]?.state === 'installed') {
      const upgrade = toolUpgrade(tool, toolOwner(state.statuses[tool.id]?.binary), state.updates!);
      rows.push(field('Update', `${outdated.installed} → ${outdated.current} · ${upgrade ? upgrade.label : UNKNOWN_OWNER_UPDATE}`));
    }
    if (tool.language) rows.push(`  ${SUBTLE}${'Language'.padEnd(10)}${RESET}${foregroundOf(languageIdentity(tool.language))}${tool.language}${RESET}`);
    const version = state.statuses[tool.id]?.version;
    if (version) rows.push(field('Version', stripAnsi(version).replace(/[\u0000-\u001f\u007f-\u009f]/gu, '')));
    if (state.configured.has(tool.id)) rows.push(field('NMSh', 'Configured in NMSh'));
    rows.push('', `  ${SUBTLE}Shell hook state is not inferred; existing hooks stay authoritative.${RESET}`);
    footer = [
      ...(state.statuses[tool.id]?.state === 'missing' ? [['I', 'install…'] as [string, string]] : []),
      ...(toolHasUpdate(state, tool) ? [['U', 'update…'] as [string, string]] : []),
      ...(tool.id === 'mise' ? [['M', 'project awareness'] as [string, string]] : []),
      ...(tool.configuration && state.statuses[tool.id]?.state === 'installed' ? [['C', 'configure'] as [string, string]] : []),
      ...(tool.providerFamily ? [['P', 'provider'] as [string, string]] : []),
      ['R', 'refresh'], ['Esc', 'back']];
  } else {
    const tierLabel = state.tier === 'enhanced' ? 'Recommended + Enhanced' : state.tier === 'recommended' || state.recommendedOnly ? 'Recommended only' : '';
    const checked = state.checking ? `  ${SUBTLE}checking for updates…${RESET}` : state.updates?.error ? `  ${SUBTLE}${state.updates.error}${RESET}` : '';
    rows.push(`  ${SUBTLE}Search${RESET}  ${state.query ? `${PRIMARY}${state.query}` : `${SUBTLE}type to filter`}${RESET}${tierLabel ? `  ${ACCENT}${tierLabel}${RESET}` : ''}${checked}`, '');
    const tools = visibleTools(state);
    state.selected = Math.max(0, Math.min(state.selected, tools.length - 1));
    const display = groupedRows(tools);
    // Rows left for the list after title, tabs, search, description and footer.
    // Below the list: a "more" cue, the description, an optional message, the footer, and the frame line.
    const budget = Math.max(1, height - rows.length - 6 - (state.message ? 2 : 0));
    const selectedRow = display.findIndex(row => row.kind === 'tool' && row.index === state.selected);
    let start = Math.max(0, Math.min(selectedRow - Math.floor(budget / 2), display.length - budget));
    // Keep the selected tool's category header in view when it fits.
    if (start > 0 && display[start]?.kind === 'tool' && selectedRow - start < budget - 1) {
      for (let back = start - 1; back >= 0 && selectedRow - back < budget; back -= 1) if (display[back]!.kind === 'header') { start = back; break; }
    }
    for (const row of display.slice(start, start + budget)) {
      rows.push(row.kind === 'header' ? `  ${ACCENT}${row.category}${RESET}` : toolRow(state, row.tool, row.index === state.selected, columns));
    }
    const more = display.length - start - budget;
    if (more > 0) rows.push(`  ${SUBTLE}${getCurrentGlyphMode() === 'nerd' ? '↓' : 'v'} ${display.slice(start + budget).filter(row => row.kind === 'tool').length} more${RESET}`);
    if (!tools.length) rows.push(`  ${SUBTLE}${state.tab === 'errors' ? 'No tool problems detected.' : 'No matching tools.'}${RESET}`);
    const selected = tools[state.selected];
    if (selected) rows.push('', `  ${SUBTLE}${state.errors[selected.id] ?? selected.description}${RESET}`);
  }
  if (state.message) rows.push('', `  ${SECONDARY}${state.message}${RESET}`);
  rows.push('', renderControls(footer));
  return framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}
