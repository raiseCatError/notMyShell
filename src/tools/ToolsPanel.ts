import type {Key} from '../terminal/keys.js';
import {clearProviderDetection, detectProvider, type ProviderStatus, type ProviderInstall} from '../providers/providers.js';
import {TaskProgress, renderTaskProgress} from '../status/TaskProgress.js';
import {createConfirm, editText, handleConfirmKey, renderConfirm, type ConfirmState} from '../ui/formControls.js';
import {renderTabStrip, framePanel} from '../ui/PanelShell.js';
import {colorLevel} from '../presentation/capabilities.js';
import {foregroundOf} from '../chroma/chroma.js';
import {languageIdentity} from '../languages/linguistLanguageColors.js';
import {stripAnsi, truncateAnsi} from '../util/text.js';
import {TOOLS, TOOL_CATEGORIES, toolInstall, type Tool} from './catalog.js';

export type ToolsTab = 'discover' | 'installed' | 'configure' | 'errors';
const TABS: readonly ToolsTab[] = ['discover', 'installed', 'configure', 'errors'];
export interface ToolsPanel {
  tab: ToolsTab; query: string; selected: number; statuses: Record<string, ProviderStatus>;
  errors: Record<string, string>; configured: ReadonlySet<string>; recommendedOnly: boolean;
  detail?: Tool; recipe?: ProviderInstall; confirm?: ConfirmState; task?: TaskProgress;
  message?: string; onboarding?: number;
}
export function createToolsPanel(configured: ReadonlySet<string> = new Set(), onboarding = false): ToolsPanel {
  return {tab: 'discover', query: '', selected: 0, statuses: {}, errors: {}, configured,
    recommendedOnly: false, ...(onboarding ? {onboarding: 2} : {})};
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
  return TOOLS.filter(tool => (state.tab !== 'discover' || !state.recommendedOnly || tool.recommended)
    && (!query || `${tool.label} ${tool.description} ${tool.category}`.toLowerCase().includes(query))
    && (state.tab !== 'installed' || state.statuses[tool.id]?.state === 'installed')
    && (state.tab !== 'configure' || !!tool.configuration)
    && (state.tab !== 'errors' || !!state.errors[tool.id] || (state.configured.has(tool.id) && state.statuses[tool.id]?.state === 'missing')))
    .sort((a, b) => TOOL_CATEGORIES.indexOf(a.category) - TOOL_CATEGORIES.indexOf(b.category)
      || Number(state.statuses[a.id]?.state === 'installed') - Number(state.statuses[b.id]?.state === 'installed') || a.label.localeCompare(b.label));
}
export type ToolsAction = 'close' | 'configure' | 'provider' | 'refresh' | 'finishOnboarding';
/** No key handler installs until a separate reviewed confirmation. */
export function toolsKey(state: ToolsPanel, key: Key): ToolsAction | undefined {
  if (state.task?.state.status === 'running') return undefined;
  if (state.onboarding !== undefined) {
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.onboarding = undefined; return 'close'; }
    if (key.kind === 'up' || key.kind === 'down') state.onboarding = (state.onboarding + (key.kind === 'up' ? 2 : 1)) % 3;
    if (key.kind === 'enter') {
      const choice = state.onboarding; state.onboarding = undefined;
      state.recommendedOnly = choice === 0;
      if (choice === 2) return 'close';
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
    if (key.value.toLowerCase() === 'i' && state.statuses[state.detail.id]?.state === 'missing') {
      state.recipe = toolInstall(state.detail);
      if (state.recipe) state.confirm = createConfirm();
      else state.message = 'No supported package manager found. Use the official source; nothing was installed.';
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
  state.confirm = undefined; state.recipe = undefined;
  const task = state.task = new TaskProgress(`Installing ${tool.label}`, changed, Date.now(), tool.label);
  if (run) await run(task, recipe);
  else await task.run(recipe.command, [...recipe.args]);
  clearProviderDetection();
  state.statuses[tool.id] = await detectProvider(tool);
  if (task.state.status === 'succeeded' && state.statuses[tool.id]?.state === 'installed') {
    delete state.errors[tool.id]; state.message = `${tool.label} installed. Shell hooks/settings were not changed.`;
  } else {
    state.errors[tool.id] = task.state.status === 'failed' ? `Installation failed: ${task.state.error ?? 'unknown error'}` : 'Package manager finished; executable was not detected.';
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
export function renderTools(state: ToolsPanel, columns: number, height: number): string[] {
  const rows: string[] = ['  Optional shell tools — NMSh works without them',
    renderTabStrip(['Discover', 'Installed', 'Configure', 'Errors'], TABS.indexOf(state.tab), columns), ''];
  if (state.onboarding !== undefined) {
    rows.push('  Optional tools: choose how to browse.', '  Browsing changes nothing. Each install requires confirmation.',
      ...['Recommended', 'Choose individually', 'Skip'].map((label, i) => `  ${i === state.onboarding ? '>' : ' '} ${label}`), '  Up/Down choose; Enter continue; Esc skip');
  } else if (state.confirm) rows.push('  Install optional tool?', `  Runs: ${state.recipe?.label}`, '  Changes installed software; no shell-hook setup.',
    renderConfirm(state.confirm, {focused: true, color: colorLevel() !== 'none'}), '  Arrows choose; Enter confirms; Esc cancels');
  else if (state.task?.state.status === 'running') rows.push(...renderTaskProgress(state.task.state));
  else if (state.detail) {
    const tool = state.detail;
    rows.push(`  ${tool.label} — ${statusText(state, tool)}${tool.recommended ? ' / Recommended' : ''}`, `  ${tool.category}`, `  ${tool.description}`,
      `  Source: ${tool.source}`, `  Install source: Homebrew (${tool.package}) when available`);
    if (tool.language) rows.push(`  Language: ${foregroundOf(languageIdentity(tool.language))}${tool.language}\u001b[0m`);
    const version = state.statuses[tool.id]?.version;
    if (version) rows.push(`  Version: ${stripAnsi(version).replace(/[\u0000-\u001f\u007f-\u009f]/gu, '')}`);
    rows.push('  Shell hook state is not inferred; existing hooks stay authoritative.',
      `  ${state.statuses[tool.id]?.state === 'missing' ? 'I install preview; ' : ''}${tool.configuration ? 'C configure; ' : ''}${tool.providerFamily ? 'P provider selection; ' : ''}R refresh; Esc back`);
  } else {
    rows.push(`  Search: ${state.query || '_'}${state.recommendedOnly ? ' / Recommended only' : ''}`);
    const tools = visibleTools(state);
    state.selected = Math.max(0, Math.min(state.selected, tools.length - 1));
    const budget = Math.max(1, height - 8);
    const start = Math.max(0, state.selected - budget + 1);
    tools.slice(start, start + budget).forEach((tool, i) => rows.push(`  ${start + i === state.selected ? '>' : ' '} ${tool.label} / ${statusText(state, tool)}${tool.recommended ? ' / Recommended' : ''} / ${tool.category}`));
    if (!tools.length) rows.push(state.tab === 'errors' ? '  No tool problems detected.' : '  No matching tools.');
    rows.push('  Type search; Up/Down select; Left/Right tabs; Enter details; Esc back');
  }
  if (state.message) rows.push(`  ${state.message}`);
  return framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}
