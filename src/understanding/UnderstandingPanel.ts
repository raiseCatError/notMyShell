import type {Key} from '../terminal/keys.js';
import type {LocalUnderstandingSettings} from '../prompt/configuration.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import {proposeSetup, type FoundModel, type FoundRuntime} from './discovery.js';
import {understandingStatusRows} from './LocalUnderstanding.js';
import type {ModelStatus} from './ModelClient.js';
import {formatBytes, type RecommendedModel} from './recommended.js';

/**
 * Providers › Local understanding: detect first, show what exists, and only
 * then offer a download or a runtime install, each previewed and starting on
 * No. NMSh performs approved steps itself; nothing is downloaded or installed
 * without Yes, and Ask and Smart Folding keep working without any of it.
 */
export interface UnderstandingPanelState {
  selected: number;
  confirm?: {kind: 'download' | 'runtime'; choice: 'yes' | 'no'};
  working?: string;
  message?: string;
}

export function createUnderstandingPanel(): UnderstandingPanelState { return {selected: 0}; }

export type UnderstandingRow =
  | {kind: 'mode'} | {kind: 'scope'; scope: 'ask' | 'folding'}
  | {kind: 'model'; model: FoundModel} | {kind: 'download'} | {kind: 'runtime'};

export type UnderstandingAction =
  | {kind: 'close'} | {kind: 'mode'; delta: 1 | -1} | {kind: 'scope'; scope: 'ask' | 'folding'}
  | {kind: 'use'; model: FoundModel} | {kind: 'download'} | {kind: 'runtime'} | {kind: 'detect'};

export interface UnderstandingFacts {
  settings: LocalUnderstandingSettings;
  discovery?: {runtimes: FoundRuntime[]; models: FoundModel[]};
  status?: ModelStatus;
  recommended?: RecommendedModel;
  /** The last download failed verification: the row says so and a retry is an explicit choice. */
  downloadFailure?: string;
  /** The llama.cpp runtime recipe NMSh can run (e.g. `brew install llama.cpp`), when one is known here. */
  runtimeRecipe?: string;
}

export function understandingRows(facts: UnderstandingFacts): UnderstandingRow[] {
  const rows: UnderstandingRow[] = [{kind: 'mode'}, {kind: 'scope', scope: 'ask'}, {kind: 'scope', scope: 'folding'}];
  for (const model of facts.discovery?.models ?? []) if (model.suitability !== 'unsuitable') rows.push({kind: 'model', model});
  const hasLlama = facts.discovery?.runtimes.some(runtime => runtime.kind === 'llama.cpp');
  // The download is offered only when nothing suitable is already here and usable.
  const needed = !facts.discovery || proposeSetup(facts.discovery).kind !== 'use';
  if (facts.recommended?.artifact && needed) rows.push({kind: 'download'});
  if (!hasLlama && facts.runtimeRecipe) rows.push({kind: 'runtime'});
  return rows;
}

export function understandingKey(state: UnderstandingPanelState, key: Key, facts: UnderstandingFacts): UnderstandingAction | undefined {
  if (state.working) return undefined;
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
  if (key.kind === 'enter' || (key.kind === 'text' && key.value === ' ')) {
    if (row.kind === 'mode') return {kind: 'mode', delta: 1};
    if (row.kind === 'scope') return {kind: 'scope', scope: row.scope};
    if (row.kind === 'model') return {kind: 'use', model: row.model};
    if (row.kind === 'download' || row.kind === 'runtime') { state.confirm = {kind: row.kind, choice: 'no'}; return undefined; }
  }
  return undefined;
}

export function renderUnderstandingPanel(state: UnderstandingPanelState, facts: UnderstandingFacts, columns: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const {settings, recommended} = facts;
  const rows = [`${primary}  Providers › Local understanding${reset}`,
    `  ${subtle}Ask and Smart Folding work without a language model. A small local model can improve how loosely worded requests are understood.${reset}`,
    `  ${subtle}Inference is local: Ask text is never sent anywhere. One model is shared by every NMSh window.${reset}`, ''];
  if (state.working) { rows.push(`  ${secondary}${state.working}${reset}`); return rows.map(row => truncateAnsi(row, columns)); }
  if (state.confirm) {
    const yes = state.confirm.choice === 'yes';
    if (state.confirm.kind === 'download' && recommended?.artifact) {
      const artifact = recommended.artifact;
      rows.push(`  ${primary}Download ${recommended.model} ${artifact.quantization}?${reset}`, '',
        `    ${secondary}Official ${artifact.publisher ?? 'Qwen'} release: ${artifact.repository} · ${artifact.file} · revision ${artifact.revision.slice(0, 12)} · license ${artifact.license}${reset}`,
        `    ${secondary}Download ${formatBytes(artifact.bytes)} · stored locally (~${formatBytes(artifact.bytes)}) · verified by sha256${reset}`,
        `    ${subtle}Inference runs on this machine; nothing you type is sent anywhere.${reset}`);
    } else {
      rows.push(`  ${primary}Install the llama.cpp runtime?${reset}`, '', `    ${primary}${facts.runtimeRecipe}${reset}`, '',
        `  ${subtle}No sudo, no install scripts, no shell configuration changes.${reset}`);
    }
    rows.push('', `  ${!yes ? `${accent}[ No ]${reset}` : `${subtle}  No  ${reset}`}   ${yes ? `${accent}[ Yes ]${reset}` : `${subtle}  Yes  ${reset}`}`,
      '', renderControls([['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']]));
    return rows.map(row => truncateAnsi(row, columns));
  }
  const list = understandingRows(facts);
  const mark = (index: number) => index === state.selected ? `${accent}${GLYPHS.selection}${reset}` : ' ';
  list.forEach((row, index) => {
    if (row.kind === 'mode') rows.push(`${mark(index)} ${primary}Local understanding${reset}   ${secondary}${['off', 'auto', 'always'].map(mode => mode === settings.mode ? `[${mode === 'off' ? 'Off' : mode === 'auto' ? 'Auto' : 'Always'}]` : mode === 'off' ? 'Off' : mode === 'auto' ? 'Auto' : 'Always').join('  ')}${reset}`);
    else if (row.kind === 'scope') rows.push(`${mark(index)}   ${secondary}${settings[row.scope] ? '[x]' : '[ ]'} Improve ${row.scope === 'ask' ? 'Ask understanding' : 'Smart Folding'}${reset}`);
    else if (row.kind === 'model') {
      const current = settings.model && settings.model.runtime === row.model.runtime && (settings.model.path === row.model.path && settings.model.name === row.model.name);
      rows.push(`${mark(index)}   ${secondary}${row.model.label}${reset}  ${subtle}${row.model.runtime}${row.model.bytes ? ` · ${formatBytes(row.model.bytes)}` : ''} · ${row.model.reason}${current ? '  [current]' : ''}${row.model.owned ? '' : ' · found on this machine'}${reset}`);
    } else if (row.kind === 'download') rows.push(`${mark(index)}   ${secondary}${facts.downloadFailure ? 'Retry download of' : 'Download'} ${recommended!.model} ${recommended!.artifact!.quantization} (${formatBytes(recommended!.artifact!.bytes)})${reset}  `
      + `${subtle}${facts.downloadFailure ? `last attempt failed: ${facts.downloadFailure}` : 'official Qwen · recommended'}${reset}`);
    else rows.push(`${mark(index)}   ${secondary}Install the llama.cpp runtime${reset}  ${subtle}${facts.runtimeRecipe}${reset}`);
  });
  rows.push('');
  if (!facts.discovery) rows.push(`  ${subtle}Looking for local runtimes and models…${reset}`);
  else {
    const runtimes = facts.discovery.runtimes.map(runtime => `${runtime.label} ${runtime.running ? 'running' : 'installed'}`).join(' · ') || 'none found';
    rows.push(`  ${subtle}Runtimes: ${runtimes}${reset}`);
    const unsuitable = facts.discovery.models.filter(model => model.suitability === 'unsuitable');
    if (unsuitable.length) rows.push(`  ${subtle}Not used: ${unsuitable.slice(0, 3).map(model => `${model.label} (${model.reason})`).join('; ')}${reset}`);
    const proposal = proposeSetup(facts.discovery);
    rows.push(`  ${secondary}${proposal.note}${proposal.kind === 'choose-large' ? ' Use it anyway, or stay with built-in understanding.' : ''}${reset}`);
    if (!recommended?.artifact && proposal.kind !== 'use') {
      rows.push(`  ${subtle}The recommended model is unavailable in this build (no verified official artifact), so NMSh will not download one.${reset}`);
    }
  }
  for (const row of understandingStatusRows(settings, facts.status)) rows.push(`  ${subtle}${row.label.padEnd(8)}${reset} ${secondary}${row.value}${reset}`);
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['←→', 'mode'], ['Enter', 'toggle / use'], ['R', 'detect again'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
