import type {Key} from '../terminal/keys.js';
import type {LocalUnderstandingSettings} from '../prompt/configuration.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {padCells, truncateAnsi} from '../util/text.js';
import {liveLine} from '../status/liveLine.js';
import {proposeSetup, recommendModel, type FoundModel, type FoundRuntime} from './discovery.js';
import type {ModelStatus} from './ModelClient.js';
import {formatBytes, type RecommendedModel} from './recommended.js';

/**
 * /llm: NMSh's Local Intelligence surface (also reached from /providers and
 * Setup Cat; one controller). Detect first, show what exists and the
 * factual choice between an existing model and the recommended download,
 * then act only after a previewed Yes. NMSh removes only what it owns: its
 * own downloaded model file, and a runtime only with recorded install
 * provenance. Ask and Smart Folding keep working without any of it.
 */
export interface UnderstandingPanelState {
  selected: number;
  confirm?: {kind: 'download' | 'runtime' | 'remove' | 'uninstallRuntime'; choice: 'yes' | 'no'};
  working?: string;
  /** A staged download/verification in progress (shared live-activity line). */
  progress?: {label: string; stage: 'Downloading' | 'Verifying SHA-256' | 'Installing' | 'Ready'; received?: number; total?: number; since: number};
  message?: string;
  /** Entered from Setup Cat: the intro says so and Esc returns there. */
  onboarding?: boolean;
}

export function createUnderstandingPanel(onboarding = false): UnderstandingPanelState { return {selected: 0, ...(onboarding ? {onboarding} : {})}; }

export type UnderstandingRow =
  | {kind: 'mode'} | {kind: 'scope'; scope: 'ask' | 'folding'}
  | {kind: 'model'; model: FoundModel} | {kind: 'download'} | {kind: 'runtime'}
  | {kind: 'detect'} | {kind: 'stop'} | {kind: 'remove'} | {kind: 'uninstallRuntime'};

export type UnderstandingAction =
  | {kind: 'close'} | {kind: 'mode'; delta: 1 | -1} | {kind: 'scope'; scope: 'ask' | 'folding'}
  | {kind: 'use'; model: FoundModel} | {kind: 'download'} | {kind: 'runtime'} | {kind: 'detect'}
  | {kind: 'stop'} | {kind: 'remove'} | {kind: 'uninstallRuntime'};

export interface UnderstandingFacts {
  settings: LocalUnderstandingSettings;
  discovery?: {runtimes: FoundRuntime[]; models: FoundModel[]};
  status?: ModelStatus;
  recommended?: RecommendedModel;
  downloadFailure?: string;
  runtimeRecipe?: string;
  /** Activity in this window: factual counters, never content. */
  activity?: {lastRoute?: {route: 'deterministic' | 'model'; at: number}; lastInference?: {label: string; at: number; ok: boolean}; requests: number};
  /** The NMSh-owned model file (inside NMSh's model directory), when one exists. */
  ownedModel?: {path: string; bytes?: number; inUse: boolean};
  /** NMSh recorded installing llama.cpp itself; only then is an uninstall offered. */
  runtimeOwned?: {label: string};
  now?: number;
}

const current = (settings: LocalUnderstandingSettings, model: FoundModel) => Boolean(settings.model && settings.model.runtime === model.runtime
  && settings.model.path === model.path && settings.model.name === model.name);

export function understandingRows(facts: UnderstandingFacts): UnderstandingRow[] {
  const rows: UnderstandingRow[] = [{kind: 'mode'}, {kind: 'scope', scope: 'ask'}, {kind: 'scope', scope: 'folding'}];
  const found = facts.discovery;
  const recommendation = found ? recommendModel(found) : undefined;
  const models = (found?.models ?? []).filter(model => model.suitability !== 'unsuitable' && !current(facts.settings, model));
  // The recommended choice comes first; both are always shown when an existing model is found.
  if (recommendation?.prefer === 'existing' && recommendation.existing) models.sort((a, b) => Number(b === recommendation.existing) - Number(a === recommendation.existing));
  const needed = !found || proposeSetup(found).kind !== 'use' || recommendation?.prefer !== 'existing';
  const download: UnderstandingRow[] = facts.recommended?.artifact && needed && !facts.ownedModel ? [{kind: 'download'}] : [];
  const modelRows = models.map(model => ({kind: 'model' as const, model}));
  rows.push(...(recommendation?.prefer === 'download' ? [...download, ...modelRows] : [...modelRows, ...download]));
  const hasLlama = found?.runtimes.some(runtime => runtime.kind === 'llama.cpp');
  if (!hasLlama && facts.runtimeRecipe) rows.push({kind: 'runtime'});
  rows.push({kind: 'detect'});
  if (facts.status && (facts.status.state === 'ready' || facts.status.state === 'busy' || facts.status.state === 'loading')) rows.push({kind: 'stop'});
  if (facts.ownedModel) rows.push({kind: 'remove'});
  if (facts.runtimeOwned) rows.push({kind: 'uninstallRuntime'});
  return rows;
}

export function understandingKey(state: UnderstandingPanelState, key: Key, facts: UnderstandingFacts): UnderstandingAction | undefined {
  if (state.working || state.progress) return undefined;
  if (state.confirm) {
    const confirm = state.confirm;
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.confirm = undefined; return undefined; }
    if (key.kind === 'left' || key.kind === 'right' || key.kind === 'up' || key.kind === 'down') confirm.choice = confirm.choice === 'no' ? 'yes' : 'no';
    else if (key.kind === 'text' && /^[yn]$/iu.test(key.value)) confirm.choice = key.value.toLowerCase() === 'y' ? 'yes' : 'no';
    else if (key.kind === 'enter') { state.confirm = undefined; return confirm.choice === 'yes' ? {kind: confirm.kind} : undefined; }
    return undefined;
  }
  const rows = understandingRows(facts);
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + rows.length) % rows.length; state.message = undefined; return undefined; }
  if (key.kind === 'text' && key.value.toLowerCase() === 'r') return {kind: 'detect'};
  const row = rows[Math.min(state.selected, rows.length - 1)];
  if (!row) return undefined;
  if (row.kind === 'mode' && (key.kind === 'left' || key.kind === 'right')) return {kind: 'mode', delta: key.kind === 'left' ? -1 : 1};
  if (row.kind === 'scope' && (key.kind === 'left' || key.kind === 'right')) return {kind: 'scope', scope: row.scope};
  if (key.kind === 'enter' || (key.kind === 'text' && key.value === ' ')) {
    if (row.kind === 'mode') return {kind: 'mode', delta: 1};
    if (row.kind === 'scope') return {kind: 'scope', scope: row.scope};
    if (row.kind === 'model') return {kind: 'use', model: row.model};
    if (row.kind === 'detect') return {kind: 'detect'};
    if (row.kind === 'stop') return {kind: 'stop'};
    if (row.kind === 'download' || row.kind === 'runtime' || row.kind === 'remove' || row.kind === 'uninstallRuntime') { state.confirm = {kind: row.kind, choice: 'no'}; return undefined; }
  }
  return undefined;
}

const MODE_LABEL = {off: 'Off', auto: 'Auto', always: 'Always'} as const;

function ago(at: number | undefined, now: number): string {
  if (!at) return 'never';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ago`;
}

export function stateLabel(status: ModelStatus | undefined, settings: LocalUnderstandingSettings): string {
  if (!settings.model) return 'Not configured';
  if (!status) return settings.mode === 'off' ? 'Off' : 'Unloaded · starts on first use';
  const state = {unloaded: settings.mode === 'auto' ? 'Unloaded · idle (Auto loads it on first use)' : 'Unloaded', loading: 'Loading', ready: 'Ready', busy: 'Busy', error: 'Error'}[status.state];
  return `${state}${status.error && status.state === 'error' ? ` · ${status.error}` : ''}`;
}

export function renderUnderstandingPanel(state: UnderstandingPanelState, facts: UnderstandingFacts, columns: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const success = foreground(UI_COLORS.success);
  const reset = '\u001b[0m';
  const safe = getCurrentGlyphMode() === 'safe';
  const now = facts.now ?? Date.now();
  const {settings, recommended} = facts;
  const rows = [`${primary}  Local Intelligence${reset}`,
    `  ${subtle}${state.onboarding ? 'Setup Cat · ' : ''}Optional. Ask and Smart Folding work without a model; a small local one helps with loose wording. Inference stays on this machine.${reset}`, ''];
  if (state.progress) {
    const progress = state.progress;
    const detail = progress.stage === 'Downloading' && progress.total
      ? `${progress.stage} · ${Math.round((progress.received ?? 0) / 1e6)} / ${Math.round(progress.total / 1e6)} MB · ${Math.floor(((progress.received ?? 0) / progress.total) * 100)}%`
      : progress.stage;
    rows.push(`  ${liveLine(progress.label, detail, progress.since, now, {elapsed: progress.stage !== 'Ready'})}`, '',
      `  ${subtle}${progress.stage === 'Verifying SHA-256' ? 'Checking the file against its pinned digest; nothing is used until it matches.' : 'Esc is unavailable until this step finishes; the partial file is removed if anything fails.'}${reset}`);
    return rows.map(row => truncateAnsi(row, columns));
  }
  if (state.working) { rows.push(`  ${secondary}${state.working}${reset}`); return rows.map(row => truncateAnsi(row, columns)); }
  if (state.confirm) {
    const yes = state.confirm.choice === 'yes';
    const kind = state.confirm.kind;
    if (kind === 'download' && recommended?.artifact) {
      const artifact = recommended.artifact;
      rows.push(`  ${primary}Download ${recommended.model} ${artifact.quantization}?${reset}`, '',
        `    ${secondary}Official ${artifact.publisher ?? 'Qwen'} release · ${artifact.repository}${reset}`,
        `    ${secondary}${artifact.file} · revision ${artifact.revision.slice(0, 12)} · license ${artifact.license}${reset}`,
        `    ${secondary}${formatBytes(artifact.bytes)} · verified by SHA-256 · stored in NMSh's model folder${reset}`);
    } else if (kind === 'runtime') {
      rows.push(`  ${primary}Install the llama.cpp runtime?${reset}`, '', `    ${primary}${facts.runtimeRecipe}${reset}`, '', `  ${subtle}No sudo, no install scripts, no shell configuration changes.${reset}`);
    } else if (kind === 'remove' && facts.ownedModel) {
      rows.push(`  ${primary}Remove the model NMSh downloaded?${reset}`, '', `    ${secondary}${facts.ownedModel.path}${reset}`,
        `    ${secondary}${facts.ownedModel.bytes ? formatBytes(facts.ownedModel.bytes) : 'size unknown'}${facts.ownedModel.inUse ? ' · in use now: it is unloaded first and the setting cleared' : ''}${reset}`,
        `  ${subtle}Only this file is deleted. Models other tools or you installed are never touched.${reset}`);
    } else if (kind === 'uninstallRuntime' && facts.runtimeOwned) {
      rows.push(`  ${primary}Uninstall llama.cpp?${reset}`, '', `    ${primary}brew uninstall llama.cpp${reset}`, `  ${subtle}NMSh installed it (${facts.runtimeOwned.label}); nothing else is removed.${reset}`);
    }
    rows.push('', `  ${!yes ? `${accent}${GLYPHS.selection} No${reset}` : `${subtle}  No${reset}`}    ${yes ? `${accent}${GLYPHS.selection} Yes${reset}` : `${subtle}  Yes${reset}`}`,
      '', renderControls([['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']]));
    return rows.map(row => truncateAnsi(row, columns));
  }
  const list = understandingRows(facts);
  const label = (text: string) => padCells(text, 20);
  const line = (index: number, text: string, value: string) => {
    const selected = index === state.selected;
    return `${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${focusForeground(selected)}${label(text)}${reset}${value}`;
  };
  const onOff = (on: boolean) => on ? `${success}On${reset}` : `${subtle}Off${reset}`;
  let section: string | undefined;
  const heading = (title: string) => { if (section !== title) { rows.push('', `  ${subtle}${title}${reset}`); section = title; } };
  list.forEach((row, index) => {
    if (row.kind === 'mode') { const mode = MODE_LABEL[settings.mode]; rows.push(line(index, 'Mode', index === state.selected ? `${accent}‹ ${mode} ›${reset}` : `${primary}${mode}${reset}`)); }
    else if (row.kind === 'scope') rows.push(line(index, row.scope === 'ask' ? 'Improve Ask' : 'Smart Folding', onOff(settings[row.scope])));
    else if (row.kind === 'model') {
      heading('Available models');
      rows.push(line(index, row.model.label.slice(0, 19), `${subtle}${row.model.runtime}${row.model.bytes ? ` · ${formatBytes(row.model.bytes)}` : ''} · ${row.model.owned ? 'NMSh managed' : 'found on this machine'}${reset}`));
    } else if (row.kind === 'download') {
      heading('Available models');
      rows.push(line(index, facts.downloadFailure ? 'Retry download' : 'Download', `${secondary}${recommended!.model} ${recommended!.artifact!.quantization}${reset} ${subtle}· ${formatBytes(recommended!.artifact!.bytes)} · official · recommended${facts.downloadFailure ? ` · last attempt failed: ${facts.downloadFailure}` : ''}${reset}`));
    } else {
      heading('Actions');
      const text = {runtime: 'Install llama.cpp', detect: 'Detect models', stop: 'Stop model', remove: 'Remove NMSh model', uninstallRuntime: 'Uninstall runtime'}[row.kind];
      const note = {runtime: facts.runtimeRecipe ?? '', detect: 'look again (local only)', stop: 'unload now; loads again on next use', remove: facts.ownedModel?.path ?? '', uninstallRuntime: 'installed by NMSh'}[row.kind];
      rows.push(line(index, text, `${subtle}${note}${reset}`));
    }
  });
  // Model: what is configured, and its facts.
  rows.push('', `  ${subtle}Model${reset}`);
  if (settings.model) {
    const size = facts.ownedModel?.inUse && facts.ownedModel.bytes ? ` · ${formatBytes(facts.ownedModel.bytes)}` : '';
    rows.push(`    ${primary}${settings.model.label}${reset}`, `    ${secondary}${stateLabel(facts.status, settings)} · ${settings.model.runtime}${size}${reset}`,
      `    ${subtle}${settings.model.owned ? 'NMSh managed' : 'Found on this machine · NMSh never deletes it'}${reset}`);
  } else rows.push(`    ${secondary}Not configured${reset}`);
  if (facts.discovery) {
    const recommendation = recommendModel(facts.discovery);
    if (recommendation.existing || !settings.model) rows.push(`    ${subtle}${recommendation.prefer === 'existing' ? 'Recommended: reuse it. ' : recommendation.prefer === 'download' ? 'Recommended: the NMSh model. ' : ''}${recommendation.reason}${reset}`);
    const runtimes = facts.discovery.runtimes.map(runtime => `${runtime.label} ${runtime.running ? 'running' : 'installed'}`).join(' · ') || 'none found';
    rows.push(`    ${subtle}Runtimes: ${runtimes}${reset}`);
  } else rows.push(`    ${subtle}${safe ? '...' : '…'} looking for local runtimes and models${reset}`);
  // Activity: factual, this window.
  if (settings.mode !== 'off') {
    const activity = facts.activity;
    const route = activity?.lastRoute ? (activity.lastRoute.route === 'model' ? settings.model?.label ?? 'Local model' : 'Deterministic') : 'none yet';
    rows.push('', `  ${subtle}Activity${reset}`,
      `    ${subtle}${label('State')}${reset}${secondary}${stateLabel(facts.status, settings)}${reset}`,
      `    ${subtle}${label('Last Ask route')}${reset}${secondary}${route}${reset}`,
      `    ${subtle}${label('Last inference')}${reset}${secondary}${activity?.lastInference ? `${activity.lastInference.label} · ${ago(activity.lastInference.at, now)}${activity.lastInference.ok ? '' : ' · not used'}` : 'never'}${reset}`,
      `    ${subtle}${label('Requests')}${reset}${secondary}${activity?.requests ?? 0}${reset}`,
      ...(facts.status ? [`    ${subtle}${label('Shared clients')}${reset}${secondary}${facts.status.clients}${facts.status.queued ? ` · ${facts.status.queued} queued` : ''}${reset}`] : []));
  }
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['←→', 'change'], ['Enter', 'choose'], ['R', 'detect'], ['Esc', state.onboarding ? 'finish' : 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
