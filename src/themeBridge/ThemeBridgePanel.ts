import type {Key} from '../terminal/keys.js';
import type {FileEditPlan} from '../ask/fileEdit.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {padCells, truncateAnsi, truncateText} from '../util/text.js';
import type {SelectableTheme, ThemeRef} from '../appearance/themeRefs.js';
import {BRIDGE_MODE_LABELS, BRIDGE_TARGETS, type BridgeMode, type BridgeTargetId} from './model.js';
import type {TargetReport} from './runtime.js';

/**
 * /theme-bridge: one row per target with its own mode and theme; a detail
 * view per target. The panel never writes anything itself: it returns
 * actions, and permanent config includes always go through a shown plan
 * (exact path and lines) and an explicit confirmation.
 */

type DetailRow = 'mode' | 'theme' | 'apply' | 'reload' | 'remove';

export interface ThemeBridgePanelState {
  selected: number;
  detail?: {target: BridgeTargetId; row: number};
  /** A permanent-change plan awaiting confirmation. */
  confirm?: {kind: 'hook' | 'removeHook'; target: BridgeTargetId; path: string; preview: string[]; plan?: FileEditPlan};
  message?: string;
}

export type BridgePanelAction =
  | {kind: 'close'}
  | {kind: 'setMode'; target: BridgeTargetId; mode: BridgeMode; theme?: ThemeRef}
  | {kind: 'setEnabled'; enabled: boolean}
  | {kind: 'planHook'; target: BridgeTargetId}
  | {kind: 'confirmHook'; target: BridgeTargetId}
  | {kind: 'planRemoval'; target: BridgeTargetId}
  | {kind: 'confirmRemoval'; target: BridgeTargetId}
  | {kind: 'reloadTmux'};

export interface BridgePanelContext {
  /** The master switch; Off keeps every target Independent. */
  enabled: boolean;
  reports: readonly TargetReport[];
  themes: readonly SelectableTheme[];
  /** The pinned reference per target (kept even while another mode is chosen). */
  pinned: (target: BridgeTargetId) => ThemeRef | undefined;
  activeRef?: ThemeRef;
  /** The managed artifact and include facts per managed target. */
  managed: (target: BridgeTargetId) => {artifact?: string; include?: string} | undefined;
}

const MANAGED = new Set<BridgeTargetId>(['tmux', 'neovim', 'vim', 'helix']);

export function createThemeBridgePanel(): ThemeBridgePanelState {
  return {selected: 0};
}

function detailRows(target: BridgeTargetId, report: TargetReport | undefined): DetailRow[] {
  const rows: DetailRow[] = ['mode'];
  if (report?.mode === 'choose') rows.push('theme');
  if (MANAGED.has(target)) rows.push('apply');
  if (target === 'tmux' && report?.mode !== 'independent') rows.push('reload');
  if (report && (report.mode !== 'independent' || MANAGED.has(target))) rows.push('remove');
  return rows;
}

export function themeBridgeKey(state: ThemeBridgePanelState, key: Key, context: BridgePanelContext): BridgePanelAction | undefined {
  state.message = undefined;
  if (state.confirm) {
    const {kind, target} = state.confirm;
    if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'y')) {
      state.confirm = undefined;
      return kind === 'hook' ? {kind: 'confirmHook', target} : {kind: 'confirmRemoval', target};
    }
    if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value.toLowerCase() === 'n')) {
      state.confirm = undefined;
      state.message = target === 'helix' && kind === 'hook' ? 'Nothing was changed. The generated theme stays available: run :theme nmsh-bridge inside Helix.' : 'Nothing was changed.';
    }
    return undefined;
  }
  if (!state.detail) {
    if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
    // Row 0 is the master switch; the targets follow.
    const count = BRIDGE_TARGETS.length + 1;
    if (key.kind === 'up' || key.kind === 'down') state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + count) % count;
    else if (state.selected === 0 && (key.kind === 'enter' || key.kind === 'left' || key.kind === 'right' || (key.kind === 'text' && key.value === ' '))) return {kind: 'setEnabled', enabled: !context.enabled};
    else if (key.kind === 'enter' || key.kind === 'right') state.detail = {target: BRIDGE_TARGETS[state.selected - 1]!, row: 0};
    return undefined;
  }
  const {target} = state.detail;
  const report = context.reports.find(item => item.target === target);
  const rows = detailRows(target, report);
  const row = rows[Math.min(state.detail.row, rows.length - 1)]!;
  if (key.kind === 'escape' || key.kind === 'interrupt') { state.detail = undefined; return undefined; }
  if (key.kind === 'up' || key.kind === 'down') { state.detail.row = (state.detail.row + (key.kind === 'up' ? -1 : 1) + rows.length) % rows.length; return undefined; }
  const delta = key.kind === 'left' ? -1 : key.kind === 'right' ? 1 : 0;
  if (row === 'mode' && (delta || key.kind === 'enter')) {
    const modes = report?.modes ?? ['independent'];
    if (modes.length === 1) { state.message = report?.notes[0] ?? 'Only Independent is available for this target.'; return undefined; }
    const mode = modes[(modes.indexOf(report?.mode ?? 'independent') + (delta || 1) + modes.length) % modes.length]!;
    // Choose theme starts on the pinned theme, or visibly on the active one; it never changes later by itself.
    const theme = mode === 'choose' ? context.pinned(target) ?? context.activeRef : undefined;
    return {kind: 'setMode', target, mode, ...(theme ? {theme} : {})};
  }
  if (row === 'theme' && (delta || key.kind === 'enter')) {
    const current = context.pinned(target);
    const index = context.themes.findIndex(theme => theme.ref === current);
    const next = context.themes[(index + (delta || 1) + context.themes.length) % context.themes.length];
    return next ? {kind: 'setMode', target, mode: 'choose', theme: next.ref} : undefined;
  }
  if (key.kind !== 'enter') return undefined;
  if (row === 'apply') return {kind: 'planHook', target};
  if (row === 'reload') return {kind: 'reloadTmux'};
  if (row === 'remove') return {kind: 'planRemoval', target};
  return undefined;
}

export function renderThemeBridgePanel(state: ThemeBridgePanelState, context: BridgePanelContext, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const warning = foreground(UI_COLORS.failure);
  const reset = '\u001B[0m';
  const out: string[] = [];
  const finish = (controls: Array<[string, string]>) => framePanel([...out, '', renderControls(controls)].map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
  if (state.confirm) {
    const {kind, path, preview} = state.confirm;
    out.push(`  ${primary}Theme Bridge › ${kind === 'hook' ? 'Add include' : 'Remove include'}${reset}`, '',
      `  ${secondary}${kind === 'hook' ? 'This edits your config so new instances load NMSh-managed colors:' : 'This removes exactly the NMSh lines from:'}${reset}`,
      `  ${primary}${path}${reset}`, '', ...preview.map(line => `    ${line.startsWith('+') ? accent : line.startsWith('-') ? warning : subtle}${line}${reset}`), '',
      `  ${subtle}Nothing else in the file changes. NMSh refuses to write if the file changes before you confirm.${reset}`);
    return finish([['Enter', kind === 'hook' ? 'add these lines' : 'remove these lines'], ['Esc', 'cancel']]);
  }
  if (!state.detail) {
    out.push(`  ${primary}Theme Bridge${reset}  ${subtle}extend NMSh themes to terminal tools · every target starts Independent${reset}`, '');
    const master = state.selected === 0;
    out.push(`${master ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${master ? primary : secondary}${padCells('Theme Bridge', 13)}${reset}${master ? `${accent}‹ ${context.enabled ? 'On' : 'Off'} ›${reset}` : context.enabled ? 'On' : 'Off'}  ${subtle}${context.enabled ? 'targets below use their own mode' : 'every target is Independent; choices below are kept'}${reset}`, '');
    out.push(`  ${subtle}${padCells('Target', 13)}${padCells('Mode', 15)}${padCells('Theme', 22)}Status${reset}`);
    BRIDGE_TARGETS.forEach((target, index) => {
      const report = context.reports.find(item => item.target === target);
      const selected = index + 1 === state.selected;
      const theme = report && report.mode !== 'independent' ? report.themeLabel ?? '—' : '—';
      const extra = report?.notes.find(note => note === 'Managed' || note.startsWith('include') || note === 'reload available');
      out.push(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${selected ? primary : secondary}${padCells(report?.label ?? target, 13)}${reset}`
        + `${padCells(BRIDGE_MODE_LABELS[report?.mode ?? 'independent'], 15)}${padCells(truncateText(theme, 20), 22)}${subtle}${report?.status ?? ''}${extra ? ` · ${extra}` : ''}${reset}`);
    });
    out.push('', `  ${subtle}Independent: NMSh does nothing to that target. Follow NMSh: the active NMSh theme. Choose theme: a pinned theme the main theme never changes.${reset}`);
    if (state.message) out.push('', `  ${secondary}${state.message}${reset}`);
    return finish([['↑↓', 'target'], ['Enter', 'details'], ['Esc', 'close']]);
  }
  const {target} = state.detail;
  const report = context.reports.find(item => item.target === target);
  const rows = detailRows(target, report);
  const selectedRow = rows[Math.min(state.detail.row, rows.length - 1)];
  const line = (row: DetailRow, label: string, value: string) => {
    const selected = row === selectedRow;
    return `${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${selected ? primary : secondary}${padCells(label, 14)}${reset}${selected && (row === 'mode' || row === 'theme') ? `${accent}‹ ${value} ›${reset}` : value}`;
  };
  out.push(`  ${primary}Theme Bridge › ${report?.label ?? target}${reset}  ${subtle}${report?.status ?? ''}${reset}`, '');
  for (const row of rows) {
    if (row === 'mode') out.push(line(row, 'Mode', BRIDGE_MODE_LABELS[report?.mode ?? 'independent']));
    if (row === 'theme') out.push(line(row, 'Theme', report?.themeLabel ?? 'Missing theme'));
    if (row === 'apply') out.push(line(row, target === 'helix' ? 'Activation' : 'Include', `${context.managed(target)?.include ? 'configured · Enter to review' : 'not configured · Enter to review the exact change'}`));
    if (row === 'reload') out.push(line(row, 'Reload', 'load the colors into the running tmux server'));
    if (row === 'remove') out.push(line(row, 'Remove', 'set Independent, remove NMSh files and (after review) the include'));
  }
  const managed = context.managed(target);
  if (managed?.artifact) out.push('', `  ${subtle}Managed file  ${managed.artifact}${reset}`);
  if (managed?.include) out.push(`  ${subtle}Include in    ${managed.include}${reset}`);
  if (report?.notes.length) out.push('', ...report.notes.filter(note => note !== 'Managed').map(note => `  ${subtle}• ${note}${reset}`));
  if (state.message) out.push('', `  ${secondary}${state.message}${reset}`);
  return finish([['↑↓', 'select'], ['←→', 'change'], ['Enter', 'open'], ['Esc', 'back']]);
}
