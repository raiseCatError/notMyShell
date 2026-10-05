import type {Key} from '../terminal/keys.js';
import {clearProviderDetection, type ProviderStatus, type ProviderInstall} from '../providers/providers.js';
import {TaskProgress, renderTaskProgress} from '../status/TaskProgress.js';
import {createConfirm, editText, handleConfirmKey, renderConfirm, type ConfirmState} from '../ui/formControls.js';
import {renderTabStrip, framePanel, onSelectedBand, selectedRowBand} from '../ui/PanelShell.js';
import {colorLevel} from '../presentation/capabilities.js';
import {foregroundOf} from '../chroma/chroma.js';
import {languageIdentity} from '../languages/linguistLanguageColors.js';
import {displayWidth, stripAnsi, truncateAnsi, truncateText} from '../util/text.js';
import {detectTool, TOOLS, TOOL_CATEGORIES, TOOL_TIER_LABELS, toolInstall, toolInstallUnavailable, type Tool, type ToolTier} from './catalog.js';
import type {PromptProviderId} from '../prompt/configuration.js';
import type {ShellId} from '../shell/adapters/ShellAdapter.js';
import {previousZshrc} from './frameworks.js';
import {ohMyZshKey, openGuidedInstall, openPrevious, renderOhMyZshView, type OhMyZshView} from './OhMyZshView.js';
import {lifecycleNote, providerLifecycle} from '../providers/providers.js';
import {toolOwner, toolUpgrade, UNKNOWN_OWNER_UPDATE, type ToolUpdateState} from './ToolUpdates.js';
import {background, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {renderControls} from '../ui/controls.js';
import {InstallProvenance, planToolUninstall, type UninstallPlan} from './InstallProvenance.js';
import {elevationNote, planPackageInstall, planUnavailableReason, systemPackageEnvironment, type PackageEnvironment, type PackagePlan} from '../packages/managers.js';
import {ACTIVATION_LABELS, type ActivationFacts} from './Activation.js';
import {CONTEXT_LABELS, detectToolContexts, relevantTools, type ToolContext} from './relevance.js';

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
  /** The pending confirmation removes software; set with its reviewed plan. */
  uninstall?: UninstallPlan;
  /** External (not NMSh-installed) Homebrew removal needs a first, explicit advanced acknowledgement. */
  advancedAcknowledged?: boolean;
  /** Safe local facts about the current directory; detected once, injectable for tests. */
  contexts?: readonly ToolContext[];
  /** Install records; injectable for tests. */
  provenance?: InstallProvenance;
  /** Runtime activation facts from the running shell; supplied by the app. */
  activation?: (toolId: string) => ActivationFacts | undefined;
  /** Package managers and privilege facts; injectable for tests. */
  packages?: PackageEnvironment;
  /** Tools ticked for one combined install (Space on the list). */
  selection?: Set<string>;
  /** A combined plan under review; installs nothing until its own confirmation. */
  bulk?: BulkReview;
  /** Canonical prompt provider state (selected in settings vs. effective now); supplied by the app, never duplicated. */
  prompt?: {selected: PromptProviderId; effective: PromptProviderId};
  /** The session's current shell backend, for factual "Zsh only" labels. */
  shellBackend?: ShellId;
  /** Oh My Zsh guided install or previous-zshrc comparison, over the detail view. */
  framework?: OhMyZshView;
  /** Files the app should open (set with the 'openFiles' action). */
  openPaths?: string[];
}
export interface BulkReview {
  items: Array<{tool: Tool; plan: PackagePlan}>;
  excluded: Array<{tool: Tool; reason: string}>;
}
export interface BulkResult {tool: Tool; ok: boolean; detail: string}

/** The reviewed install for one tool: the detected package manager's exact argv, or undefined for manual. */
export function installPlanFor(state: ToolsPanel, tool: Tool): ProviderInstall | undefined {
  if (tool.install) return toolInstall(tool);
  return planPackageInstall(tool, state.packages ??= systemPackageEnvironment());
}
export function installUnavailableFor(state: ToolsPanel, tool: Tool): string {
  if (tool.install || tool.legacy) return toolInstallUnavailable(tool);
  return planUnavailableReason(tool, state.packages ??= systemPackageEnvironment());
}
/** Builds the combined plan for the ticked tools; tools without a plan are listed as excluded, never installed. */
export function reviewBulk(state: ToolsPanel): BulkReview {
  const review: BulkReview = {items: [], excluded: []};
  for (const id of state.selection ?? []) {
    const tool = TOOLS.find(item => item.id === id);
    if (!tool) continue;
    if (state.statuses[tool.id]?.state !== 'missing') { review.excluded.push({tool, reason: 'already installed or not checked'}); continue; }
    const plan = installPlanFor(state, tool) as PackagePlan | undefined;
    if (plan?.manager) review.items.push({tool, plan});
    else review.excluded.push({tool, reason: installUnavailableFor(state, tool)});
  }
  return review;
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
      state.statuses[tool.id] = await detectTool(tool);
    }));
    changed();
  }
}
/** Missing tools whose declared relevance matches this directory, with the matching fact. */
export function relevantHere(state: ToolsPanel): Map<string, ToolContext> {
  if (state.tab !== 'discover' || state.query.trim()) return new Map();
  state.contexts ??= detectToolContexts(process.cwd());
  return new Map(relevantTools(TOOLS, state.contexts, tool => state.statuses[tool.id]?.state === 'missing').map(item => [item.tool.id, item.because]));
}
export const RELEVANT_GROUP = 'Relevant here';
export function visibleTools(state: ToolsPanel): Tool[] {
  const relevant = relevantHere(state);
  const query = state.query.trim().toLowerCase();
  const tier = state.tier ?? (state.recommendedOnly ? 'recommended' : undefined);
  return TOOLS.filter(tool => (state.tab !== 'discover' || !tier || tool.tier === 'recommended' || (tier === 'enhanced' && tool.tier === 'enhanced'))
    && (!query || `${tool.label} ${tool.description} ${tool.category}`.toLowerCase().includes(query))
    && (state.tab !== 'installed' || state.statuses[tool.id]?.state === 'installed')
    && (state.tab !== 'configure' || !!tool.configuration)
    && (state.tab !== 'errors' || !!state.errors[tool.id] || (state.configured.has(tool.id) && state.statuses[tool.id]?.state === 'missing')))
    .sort((a, b) => Number(relevant.has(b.id)) - Number(relevant.has(a.id))
      || (relevant.has(a.id) ? relevantRank(a) - relevantRank(b) : 0)
      || TOOL_CATEGORIES.indexOf(a.category) - TOOL_CATEGORIES.indexOf(b.category)
      || Number(state.statuses[a.id]?.state === 'installed') - Number(state.statuses[b.id]?.state === 'installed') || a.label.localeCompare(b.label));
}
const relevantRank = (tool: Tool) => tool.tier === 'recommended' ? 0 : tool.tier === 'enhanced' ? 1 : 2;
export type ToolsAction = 'close' | 'configure' | 'provider' | 'refresh' | 'finishOnboarding' | 'mise' | 'checkUpdates'
  | 'usePrompt' | 'promptSettings' | 'p10kConfigure' | 'importAppearance' | 'openFiles';

/** The prompt-provider word for a tool, from the one canonical state. */
export function promptRole(state: ToolsPanel, tool: Tool): string | undefined {
  if (!tool.promptProvider || !state.prompt) return undefined;
  if (state.prompt.effective === tool.promptProvider) return 'Active prompt provider';
  if (state.prompt.selected === tool.promptProvider) return 'Selected prompt provider · not active (NMSh Native in use)';
  return 'Prompt provider';
}

/** Factual one-line status: what it is, and scope when the backend differs. */
export function toolStatusLine(state: ToolsPanel, tool: Tool): string {
  const status = state.statuses[tool.id];
  const kind = tool.capabilities?.includes('shell framework') ? 'Zsh framework' : tool.promptProvider ? promptRole(state, tool) ?? 'Prompt provider' : undefined;
  const zshOnly = tool.shells?.length === 1 && tool.shells[0] === 'zsh';
  if (!status) return 'Checking';
  if (status.state === 'installed') {
    const scope = zshOnly && state.shellBackend && state.shellBackend !== 'zsh' ? 'used by Zsh only' : undefined;
    return ['Installed', kind, scope].filter(Boolean).join(' · ');
  }
  return status.state === 'missing' ? ['Not installed', zshOnly ? 'Zsh only' : undefined].filter(Boolean).join(' · ') : 'Needs attention';
}

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
  if (state.framework) {
    const result = ohMyZshKey(state.framework, key);
    if (result === 'back') state.framework = undefined;
    else if (result) { state.openPaths = result.open; return 'openFiles'; }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (state.selection?.size && !state.detail) { state.selection.clear(); state.message = 'Selection cleared. Nothing was installed.'; }
    else if (state.detail) { state.detail = undefined; state.message = undefined; }
    else if (state.query) { state.query = ''; state.selected = 0; }
    else return 'close';
  } else if (state.detail) {
    if (key.kind !== 'text') return undefined;
    if (key.value.toLowerCase() === 'm' && state.detail.id === 'mise') return 'mise';
    const installed = state.statuses[state.detail.id]?.state === 'installed';
    const lower = key.value.toLowerCase();
    if (state.detail.promptProvider && installed && lower === 'a') return 'usePrompt';
    if (state.detail.promptProvider && lower === 's') return 'promptSettings';
    if (state.detail.id === 'powerlevel10k' && installed && lower === 'c') return 'p10kConfigure';
    if (state.detail.capabilities?.includes('Theme Studio import source') && installed && lower === 't') return 'importAppearance';
    if (state.detail.installAdapter && !installed && lower === 'i') { state.framework = openGuidedInstall(); return undefined; }
    if (state.detail.id === 'oh-my-zsh' && lower === 'o') {
      const view = openPrevious();
      if (view) state.framework = view; else state.message = 'No .zshrc.pre-oh-my-zsh was found.';
      return undefined;
    }
    if (key.value.toLowerCase() === 'u' && toolHasUpdate(state, state.detail)) {
      const upgrade = toolUpgrade(state.detail, toolOwner(state.statuses[state.detail.id]?.binary), state.updates!);
      if (upgrade) { state.recipe = upgrade; state.upgrading = true; state.confirm = createConfirm(); }
      else state.message = `${UNKNOWN_OWNER_UPDATE} NMSh did not install ${state.detail.label} and does not guess its package manager.`;
      return undefined;
    }
    if (state.detail.detection?.kind === 'filesystem' && (lower === 'x' || lower === 'i')) {
      state.message = `NMSh does not install or remove ${state.detail.label}; it is detected only.`;
      return undefined;
    }
    if (key.value.toLowerCase() === 'x' && state.statuses[state.detail.id]?.state === 'installed') {
      const provenance = state.provenance ?? new InstallProvenance();
      const plan = planToolUninstall(state.detail, provenance.find(state.detail.id), toolOwner(state.statuses[state.detail.id]?.binary));
      if (plan.kind === 'manual') { state.message = plan.provenance; return undefined; }
      state.uninstall = plan;
      state.advancedAcknowledged = plan.kind === 'recorded';
      state.recipe = {label: plan.label, command: plan.command, args: plan.args};
      state.confirm = createConfirm();
      return undefined;
    }
    if (key.value.toLowerCase() === 'i' && state.statuses[state.detail.id]?.state === 'missing') {
      state.recipe = installPlanFor(state, state.detail);
      if (state.recipe) state.confirm = createConfirm();
      else state.message = `${installUnavailableFor(state, state.detail)} Nothing was installed.`;
    } else if (key.value.toLowerCase() === 'c' && state.detail.configuration && state.statuses[state.detail.id]?.state === 'installed') return 'configure';
    else if (key.value.toLowerCase() === 'p' && state.detail.providerFamily) return 'provider';
    else if (key.value.toLowerCase() === 'r') return 'refresh';
  } else if (key.kind === 'left' || key.kind === 'right') {
    const index = TABS.indexOf(state.tab);
    state.tab = TABS[(index + (key.kind === 'left' ? 3 : 1)) % TABS.length]!;
    state.selected = 0;
  } else if (key.kind === 'up' || key.kind === 'down') {
    state.selected = Math.max(0, Math.min(visibleTools(state).length - 1, state.selected + (key.kind === 'up' ? -1 : 1)));
  } else if (key.kind === 'enter' && state.selection?.size) {
    state.bulk = reviewBulk(state);
    if (state.bulk.items.length) state.confirm = createConfirm();
    else { state.message = 'None of the selected tools can be installed automatically here. Nothing was installed.'; state.bulk = undefined; }
  } else if (key.kind === 'enter') state.detail = visibleTools(state)[state.selected];
  else if (key.kind === 'text' && key.value === ' ' && !state.query && state.tab === 'discover') {
    const tool = visibleTools(state)[state.selected];
    const selection = state.selection ??= new Set();
    if (!tool) return undefined;
    if (selection.has(tool.id)) selection.delete(tool.id);
    else if (state.statuses[tool.id]?.state !== 'missing') state.message = `${tool.label} is not missing, so it cannot be selected for install.`;
    else if (!installPlanFor(state, tool)) state.message = `${installUnavailableFor(state, tool)} It cannot be selected.`;
    else { selection.add(tool.id); state.message = undefined; }
  }  else if (key.kind === 'text' && key.value === 'U' && !state.query) return 'checkUpdates';
  else {
    const next = editText(state.query, key);
    if (next !== undefined) { state.query = next; state.selected = 0; }
  }
  return undefined;
}

export async function confirmToolInstall(state: ToolsPanel, key: Key, changed: () => void,
  run?: (task: TaskProgress, recipe: ProviderInstall) => Promise<void>): Promise<void> {
  if (state.bulk && state.confirm) { await confirmBulk(state, key, changed, run); return; }
  if (!state.confirm || !state.recipe || !state.detail) return;
  const decision = handleConfirmKey(key.kind === 'interrupt' ? {kind: 'escape'} : key, state.confirm);
  if (decision === 'cancel') { state.confirm = undefined; state.recipe = undefined; state.uninstall = undefined; state.advancedAcknowledged = undefined; return; }
  if (decision !== 'confirm') return;
  if (state.uninstall && !state.advancedAcknowledged) {
    // Software NMSh did not install: a second, fresh confirmation, again starting on No.
    state.advancedAcknowledged = true;
    state.confirm = createConfirm();
    return;
  }
  if (state.uninstall) { await runUninstall(state, changed, run); return; }
  const recipe = state.recipe;
  const tool = state.detail;
  const upgrading = state.upgrading === true;
  state.confirm = undefined; state.recipe = undefined; state.upgrading = undefined;
  const task = state.task = new TaskProgress(`${upgrading ? 'Upgrading' : 'Installing'} ${tool.label}`, changed, Date.now(), tool.label);
  if (run) await run(task, recipe);
  else await task.run(recipe.command, [...recipe.args]);
  clearProviderDetection();
  state.statuses[tool.id] = await detectTool(tool);
  if (task.state.status === 'succeeded' && state.statuses[tool.id]?.state === 'installed') {
    delete state.errors[tool.id];
    if (!upgrading) try { (state.provenance ?? new InstallProvenance()).record(tool, recipe); } catch { /* provenance is best effort */ }
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
/** One explicit confirmation, then each tool in turn; a failure never undoes or blocks the others. */
async function confirmBulk(state: ToolsPanel, key: Key, changed: () => void,
  run?: (task: TaskProgress, recipe: ProviderInstall) => Promise<void>): Promise<void> {
  const decision = handleConfirmKey(key.kind === 'interrupt' ? {kind: 'escape'} : key, state.confirm!);
  if (decision === 'cancel') { state.confirm = undefined; state.bulk = undefined; state.message = 'Cancelled. Nothing was installed.'; return; }
  if (decision !== 'confirm') return;
  const review = state.bulk!;
  state.confirm = undefined; state.bulk = undefined;
  const results: BulkResult[] = [];
  for (const {tool, plan} of review.items) {
    const task = state.task = new TaskProgress(`Installing ${tool.label}`, changed, Date.now(), tool.label);
    try {
      if (run) await run(task, plan); else await task.run(plan.command, [...plan.args]);
    } catch (error) {
      results.push({tool, ok: false, detail: error instanceof Error ? error.message : String(error)});
      state.errors[tool.id] = `Installation failed: ${results.at(-1)!.detail}`;
      continue;
    }
    clearProviderDetection();
    state.statuses[tool.id] = await detectTool(tool);
    if (task.state.status === 'succeeded' && state.statuses[tool.id]?.state === 'installed') {
      delete state.errors[tool.id];
      try { (state.provenance ?? new InstallProvenance()).record(tool, plan); } catch { /* provenance is best effort */ }
      results.push({tool, ok: true, detail: 'installed'});
    } else {
      const detail = task.state.status === 'failed' ? task.state.error ?? 'unknown error' : 'package manager finished; executable was not detected';
      state.errors[tool.id] = `Installation failed: ${detail}`;
      results.push({tool, ok: false, detail: plan.elevation === 'administrator' && plan.command === 'sudo' ? `${detail} (run yourself: ${plan.manual})` : detail});
    }
    changed();
  }
  state.selection = new Set(results.filter(result => !result.ok).map(result => result.tool.id));
  state.task = undefined;
  state.message = [`Installed ${results.filter(result => result.ok).length} of ${results.length}.`,
    ...results.filter(result => !result.ok).map(result => `${result.tool.label}: ${result.detail}`)].join(' ');
  changed();
}
async function runUninstall(state: ToolsPanel, changed: () => void, run?: (task: TaskProgress, recipe: ProviderInstall) => Promise<void>): Promise<void> {
  const recipe = state.recipe!;
  const tool = state.detail!;
  state.confirm = undefined; state.recipe = undefined; state.uninstall = undefined; state.advancedAcknowledged = undefined;
  const task = state.task = new TaskProgress(`Uninstalling ${tool.label}`, changed, Date.now(), tool.label);
  // argv only: no shell, no sudo, no interpolation.
  if (run) await run(task, recipe);
  else await task.run(recipe.command, [...recipe.args]);
  clearProviderDetection();
  state.statuses[tool.id] = await detectTool(tool);
  if (task.state.status === 'succeeded') {
    try { (state.provenance ?? new InstallProvenance()).forget(tool.id); } catch { /* record cleanup is best effort */ }
    state.message = state.statuses[tool.id]?.state === 'missing'
      ? `${tool.label} uninstalled. Your settings and shell config were not changed.`
      : `${recipe.label} finished, but ${tool.label} is still on PATH (another installation provides it).`;
    delete state.errors[tool.id];
  } else {
    state.errors[tool.id] = `Uninstall failed: ${task.state.error ?? 'unknown error'}`;
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

export function toolBadges(state: ToolsPanel, tool: Tool): string[] {
  const lifecycle = providerLifecycle(tool);
  const role = promptRole(state, tool);
  const zshOnly = tool.shells?.length === 1 && tool.shells[0] === 'zsh' && state.shellBackend !== undefined && state.shellBackend !== 'zsh';
  return [...(tool.capabilities?.includes('shell framework') ? ['Zsh framework'] : []), ...(role ? [role] : []), ...(zshOnly ? ['Zsh only'] : []),
    ...(tool.integration ? [`Integrated · ${tool.integration[0]!.toUpperCase()}${tool.integration.slice(1)}`] : []),
    ...(tool.discoveryKind === 'environment' ? ['Detected environment'] : tool.tier ? [TOOL_TIER_LABELS[tool.tier]] : []),
    ...(providerLifecycle(tool) === 'legacy' ? [`${tool.successor ?? 'Maintained alternative'} recommended`] : []),
    ...(state.configured.has(tool.id) ? ['Configured in NMSh'] : []),
    ...(toolHasUpdate(state, tool) ? ['Update available'] : []),
    ...(lifecycle === 'legacy' ? ['Legacy'] : lifecycle === 'maintenance' ? ['Maintenance'] : []),
    ...(state.errors[tool.id] ? ['Error'] : [])];
}

/** One aligned tool row; the selected row gets the shared selection background, a pointer and a bright label. */
function toolRow(state: ToolsPanel, tool: Tool, selected: boolean, columns: number): string {
  const badge = statusBadge(state, tool);
  const labelWidth = columns >= 60 ? 22 : Math.max(8, columns - 18);
  const label = truncateText(tool.label, labelWidth - 1).padEnd(labelWidth);
  const statusText = columns >= 34 ? badge.text.padEnd(18) : `${badge.text.slice(0, 1)} `;
  const badges = columns >= 60 ? toolBadges(state, tool).join(' · ') : '';
  const chosen = state.selection?.has(tool.id) ?? false;
  const checkbox = state.tab === 'discover' ? `${chosen ? ACCENT : selected ? onSelectedBand() : SUBTLE}[${chosen ? 'x' : ' '}]${RESET} ` : '';
  if (!selected) return truncateAnsi(`    ${checkbox}${SECONDARY}${label}${RESET}${badge.color}${statusText}${SUBTLE}${badges}${RESET}`, columns);
  // The shared selected band (the active tab's treatment): pointer, bold label, and every quiet part lifted
  // to the band's foreground; Installed and Needs attention keep their meaning colors.
  const quiet = onSelectedBand();
  const statusColor = badge.color === SUBTLE ? quiet : badge.color;
  return selectedRowBand(`  ${ACCENT}${GLYPHS.selection}${RESET} ${checkbox}${BOLD}${ACCENT}${label}${RESET}${statusColor}${statusText}${RESET}${quiet}${badges}`, columns);
}

const BOLD = '\u001b[1m';

/** Category headers and tool rows in display order; headers are not selectable. */
function groupedRows(tools: readonly Tool[], relevant: ReadonlyMap<string, ToolContext> = new Map()): Array<{kind: 'header'; category: string} | {kind: 'tool'; tool: Tool; index: number}> {
  const rows: Array<{kind: 'header'; category: string} | {kind: 'tool'; tool: Tool; index: number}> = [];
  const group = (tool: Tool) => relevant.has(tool.id) ? RELEVANT_GROUP : tool.category;
  tools.forEach((tool, index) => {
    if (index === 0 || group(tools[index - 1]!) !== group(tool)) rows.push({kind: 'header', category: group(tool)});
    rows.push({kind: 'tool', tool, index});
  });
  return rows;
}

export function renderTools(state: ToolsPanel, columns: number, height: number): string[] {
  resolveColors();
  const tabsRow = renderTabStrip(['Discover', 'Installed', 'Configure', 'Errors'], TABS.indexOf(state.tab), columns);
  const rows: string[] = [`${PRIMARY}  Tools${RESET}  ${SUBTLE}optional · NMSh is complete without them; switch providers anytime${RESET}`, tabsRow, ''];
  let footer: Array<[string, string]> = [['↑↓', 'select'], ['←→', 'tabs'], ...(state.tab === 'discover' ? [['Space', state.selection?.size ? `select · ${state.selection.size} chosen` : 'select'] as [string, string]] : []), ['Enter', state.selection?.size ? 'review install' : 'details'], ['type', 'search'], ['U', 'check updates'], ['Esc', state.query ? 'clear search' : 'close']];
  if (state.onboarding !== undefined) {
    rows.push(`${PRIMARY}  NMSh is complete out of the box. No external shell tools are required.${RESET}`,
      `${SUBTLE}  Optional tools can be added now or later; browsing changes nothing and each install asks first.${RESET}`,
      `${SUBTLE}  Run /setup anytime to revisit these choices.${RESET}`, '',
      ...ONBOARDING_CHOICES.map((label, i) => i === state.onboarding
        ? `  ${ACCENT}${GLYPHS.selection} ${PRIMARY}${label}${RESET}` : `    ${SECONDARY}${label}${RESET}`));
    footer = [['↑↓', 'choose'], ['Enter', 'continue'], ['Esc', 'skip']];
  } else if (state.confirm && state.bulk) {
    const plans = state.bulk.items;
    rows.push(`${PRIMARY}  Install ${plans.length} tool${plans.length === 1 ? '' : 's'}?${RESET}`, '',
      ...plans.map(({tool, plan}) => `  ${SECONDARY}${tool.label}${RESET} ${SUBTLE}→${RESET} ${SECONDARY}${plan.managerLabel}${RESET} ${SUBTLE}→${RESET} ${PRIMARY}${plan.package}${RESET}  ${SUBTLE}${plan.label}${RESET}`),
      ...(plans.some(({plan}) => plan.elevation === 'administrator') ? ['', `  ${FAILURE}${elevationNote(plans.find(({plan}) => plan.elevation === 'administrator')!.plan)}${RESET}`] : []),
      ...(state.bulk.excluded.length ? ['', `  ${SUBTLE}Not included:${RESET}`, ...state.bulk.excluded.map(item => `  ${SUBTLE}${item.tool.label}: ${item.reason}${RESET}`)] : []),
      '', `  ${SUBTLE}Each runs separately; one failing does not undo the others. Shell hooks and settings are not touched.${RESET}`, '',
      `  ${renderConfirm(state.confirm, {focused: true, color: colorLevel() !== 'none'})}`);
    footer = [['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']];
  } else if (state.confirm && state.uninstall) {
    const external = state.uninstall.kind === 'external-homebrew';
    rows.push(`${PRIMARY}  Uninstall ${state.detail?.label ?? 'tool'}?${RESET}`, '',
      `  ${SUBTLE}Provenance${RESET}  ${SECONDARY}${state.uninstall.provenance}${RESET}`,
      `  ${SUBTLE}Runs${RESET}        ${PRIMARY}${state.recipe?.label ?? ''}${RESET}  ${SUBTLE}(no sudo, no shell)${RESET}`,
      ...(external && !state.advancedAcknowledged ? ['', `  ${FAILURE}Advanced: this removes software NMSh did not install. Continue to the final confirmation?${RESET}`] : []),
      ...(external && state.advancedAcknowledged ? ['', `  ${FAILURE}Final confirmation for software NMSh did not install.${RESET}`] : []),
      `  ${SUBTLE}Your NMSh settings and shell config are not changed.${RESET}`, '',
      `  ${renderConfirm(state.confirm, {focused: true, color: colorLevel() !== 'none'})}`);
    footer = [['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']];
  } else if (state.confirm) {
    rows.push(`${PRIMARY}  ${state.upgrading ? 'Upgrade' : 'Install'} ${state.detail?.label ?? 'tool'}?${RESET}`, '', `  ${SUBTLE}Runs${RESET}  ${PRIMARY}${state.recipe?.label ?? ''}${RESET}`,
      ...(state.recipe && 'elevation' in state.recipe && elevationNote(state.recipe as PackagePlan) ? [`  ${FAILURE}${elevationNote(state.recipe as PackagePlan)}${RESET}`] : []),
      `  ${SUBTLE}Changes installed software only; shell hooks and settings are not touched.${RESET}`, '',
      `  ${renderConfirm(state.confirm, {focused: true, color: colorLevel() !== 'none'})}`);
    footer = [['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']];
  } else if (state.task?.state.status === 'running') {
    rows.push(...renderTaskProgress(state.task.state));
    footer = [['Please wait', 'installation in progress']];
  } else if (state.framework) {
    const view = renderOhMyZshView(state.framework);
    rows.push(`  ${PRIMARY}${BOLD}${state.framework.kind === 'guided' ? 'Oh My Zsh · guided install' : 'Oh My Zsh · previous zshrc'}${RESET}`, '',
      ...view.rows.map(row => row.startsWith('! ') ? `  ${FAILURE}${row}${RESET}` : `  ${SECONDARY}${row}${RESET}`));
    footer = view.footer;
  } else if (state.detail) {
    const tool = state.detail;
    const badge = statusBadge(state, tool);
    const field = (label: string, value: string) => `  ${SUBTLE}${label.padEnd(10)}${RESET}${SECONDARY}${value}${RESET}`;
    rows.push(`  ${PRIMARY}${BOLD}${tool.label}${RESET}  ${badge.color}${badge.text}${RESET}${toolBadges(state, tool).length ? `  ${SUBTLE}${toolBadges(state, tool).join(' · ')}${RESET}` : ''}`,
      `  ${SUBTLE}${tool.description}${RESET}`, '',
      field('Category', tool.category), field('Source', tool.source),
      field('Status', toolStatusLine(state, tool)),
      ...(tool.capabilities?.length ? [field('Is', tool.capabilities.join(' · '))] : []),
      ...(tool.detection?.kind === 'filesystem' && state.statuses[tool.id]?.detail ? [field('Found', state.statuses[tool.id]!.detail!)] : []),
      field('Install', tool.installAdapter && state.statuses[tool.id]?.state === 'missing' ? 'Guided: NMSh keeps your .zshrc and never runs the installer itself (I)'
        : state.statuses[tool.id]?.state === 'missing'
          ? installPlanFor(state, tool)?.label ?? installUnavailableFor(state, tool)
          : tool.package ? `Package ${tool.package}` : tool.detection?.kind === 'filesystem' ? 'Installed outside NMSh · not managed by NMSh' : 'Installed outside NMSh'));
    if (tool.id === 'oh-my-zsh' && previousZshrc()) rows.push(field('Previous', 'Previous zshrc found (.zshrc.pre-oh-my-zsh) · O to compare'));
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
    if (state.configured.has(tool.id)) rows.push(field('NMSh', 'Integration selected in NMSh'));
    const activation = state.statuses[tool.id]?.state === 'installed' ? state.activation?.(tool.id) : undefined;
    if (activation) rows.push(field('Shell', `${ACTIVATION_LABELS[activation.state]} · ${activation.detail}`));
    rows.push('', `  ${SUBTLE}${activation ? 'Shell state comes from the running session; rc files are never read.' : 'Shell hook state is not inferred; existing hooks stay authoritative.'}${RESET}`);
    footer = [
      ...(state.statuses[tool.id]?.state === 'missing' && tool.detection?.kind !== 'filesystem' ? [['I', 'install…'] as [string, string]] : []),
      ...(state.statuses[tool.id]?.state === 'installed' && tool.detection?.kind !== 'filesystem' ? [['X', 'uninstall…'] as [string, string]] : []),
      ...(toolHasUpdate(state, tool) ? [['U', 'update…'] as [string, string]] : []),
      ...(tool.id === 'mise' ? [['M', 'project awareness'] as [string, string]] : []),
      ...(tool.configuration && state.statuses[tool.id]?.state === 'installed' ? [['C', 'configure'] as [string, string]] : []),
      ...(tool.providerFamily ? [['P', 'provider'] as [string, string]] : []),
      ...(tool.promptProvider && state.statuses[tool.id]?.state === 'installed' ? [['A', 'use as prompt'] as [string, string]] : []),
      ...(tool.promptProvider ? [['S', 'prompt settings'] as [string, string]] : []),
      ...(tool.id === 'powerlevel10k' && state.statuses[tool.id]?.state === 'installed' ? [['C', 'configure (p10k configure)'] as [string, string]] : []),
      ...(tool.capabilities?.includes('Theme Studio import source') && state.statuses[tool.id]?.state === 'installed' ? [['T', 'import appearance into NMSh Native'] as [string, string]] : []),
      ...(tool.installAdapter && state.statuses[tool.id]?.state === 'missing' ? [['I', 'guided install…'] as [string, string]] : []),
      ...(tool.id === 'oh-my-zsh' && previousZshrc() ? [['O', 'previous zshrc'] as [string, string]] : []),
      ['R', 'refresh'], ['Esc', 'back']];
  } else {
    const tierLabel = state.tier === 'enhanced' ? 'Recommended + Enhanced' : state.tier === 'recommended' || state.recommendedOnly ? 'Recommended only' : '';
    const checked = state.checking ? `  ${SUBTLE}checking for updates…${RESET}` : state.updates?.error ? `  ${SUBTLE}${state.updates.error}${RESET}` : '';
    rows.push(`  ${SUBTLE}Search${RESET}  ${state.query ? `${PRIMARY}${state.query}` : `${SUBTLE}type to filter`}${RESET}${tierLabel ? `  ${ACCENT}${tierLabel}${RESET}` : ''}${checked}`, '');
    const tools = visibleTools(state);
    state.selected = Math.max(0, Math.min(state.selected, tools.length - 1));
    const relevant = relevantHere(state);
    const display = groupedRows(tools, relevant);
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
    if (selected) rows.push('', `  ${SUBTLE}${state.errors[selected.id] ?? selected.description}${selected && relevant.has(selected.id) ? ` Shown because this looks like a ${CONTEXT_LABELS[relevant.get(selected.id)!]}.` : ''}${RESET}`);
  }
  if (state.message) rows.push('', `  ${SECONDARY}${state.message}${RESET}`);
  rows.push('', renderControls(footer));
  return framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}
