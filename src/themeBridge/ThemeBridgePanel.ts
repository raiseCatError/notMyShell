import type {Key} from '../terminal/keys.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {padCells, truncateAnsi, truncateText} from '../util/text.js';
import type {SelectableTheme, ThemeRef} from '../appearance/themeRefs.js';
import {
  BRIDGE_CAPABILITY, BRIDGE_CAPABILITY_LABELS, BRIDGE_MODE_LABELS, BRIDGE_POLICIES, BRIDGE_POLICY_LABELS, BRIDGE_TARGETS, type BridgeCapability, type BridgeMode,
  type BridgePolicy, type BridgeTargetId,
} from './model.js';
import type {HealthItem, TargetReport} from './runtime.js';

/**
 * /theme-bridge: one persistent panel. The switch and the apply policy sit
 * on top, then every target grouped by capability; Enter expands a target's
 * controls inline under its row while the list stays visible. Under a global
 * policy the per-target rows are view-only. The panel never writes anything:
 * it returns actions, and permanent config edits, bat's cache build and
 * Apply all always go through a shown review first.
 */

export type DetailRow = 'mode' | 'theme' | 'include' | 'reload' | 'batSetup' | 'batDuplicate' | 'batRebuild' | 'removeSetup' | 'setIndependent';

export type PanelItem =
  | {kind: 'switch'} | {kind: 'policy'} | {kind: 'globalTheme'} | {kind: 'review'}
  | {kind: 'target'; target: BridgeTargetId}
  | {kind: 'detail'; target: BridgeTargetId; row: DetailRow};

export interface ThemeBridgePanelState {
  /** Index into the flat list of selectable items. */
  selected: number;
  /** The target whose controls are expanded inline. */
  expanded?: BridgeTargetId;
  /** A permanent-change plan awaiting confirmation (shown in place of the list so the exact diff is readable). */
  confirm?: {kind: 'hook' | 'removeSetup' | 'batCache'; target: BridgeTargetId; path: string; preview: string[]};
  /** The combined integrations review; Apply defaults to No. */
  review?: {items: HealthItem[]; previews: Record<string, string[]>; yes: boolean};
  message?: string;
}

export type BridgePanelAction =
  | {kind: 'close'}
  | {kind: 'setEnabled'; enabled: boolean}
  | {kind: 'setPolicy'; policy: BridgePolicy; theme?: ThemeRef}
  | {kind: 'setGlobalTheme'; theme: ThemeRef}
  | {kind: 'setMode'; target: BridgeTargetId; mode: BridgeMode; theme?: ThemeRef}
  | {kind: 'planHook'; target: BridgeTargetId}
  | {kind: 'confirmHook'; target: BridgeTargetId}
  | {kind: 'planRemoval'; target: BridgeTargetId}
  | {kind: 'confirmRemoval'; target: BridgeTargetId}
  | {kind: 'reloadTmux'}
  | {kind: 'planBat'; source: 'current' | 'duplicate'}
  | {kind: 'confirmBat'}
  | {kind: 'reviewAll'}
  | {kind: 'applyAll'};

export interface BridgePanelContext {
  enabled: boolean;
  policy: BridgePolicy;
  globalTheme?: ThemeRef;
  globalThemeLabel?: string;
  reports: readonly TargetReport[];
  themes: readonly SelectableTheme[];
  /** The pinned reference per target in the Manual state (kept while another mode applies). */
  pinned: (target: BridgeTargetId) => ThemeRef | undefined;
  activeRef?: ThemeRef;
  activeLabel?: string;
  /** Managed artifact and include facts per managed target. */
  managed: (target: BridgeTargetId) => {artifact?: string; include?: string} | undefined;
}

const GROUPS: readonly BridgeCapability[] = ['direct', 'managed', 'detected'];

export function createThemeBridgePanel(): ThemeBridgePanelState {
  return {selected: 0};
}

export function detailRows(target: BridgeTargetId, report: TargetReport | undefined, context: BridgePanelContext): DetailRow[] {
  if (!report || BRIDGE_CAPABILITY[target] === 'detected') return [];
  const rows: DetailRow[] = [];
  if (report.editable) rows.push('mode');
  if (report.editable && report.mode === 'choose') rows.push('theme');
  if (BRIDGE_CAPABILITY[target] === 'managed' && target !== 'bat' && report.mode !== 'independent') rows.push('include');
  if (target === 'tmux' && report.mode !== 'independent') rows.push('reload');
  if (target === 'bat' && report.mode !== 'independent') rows.push(report.readiness === 'Needs setup' || !report.readiness ? 'batSetup' : 'batRebuild', 'batDuplicate');
  if (BRIDGE_CAPABILITY[target] === 'managed' && (context.managed(target)?.artifact || context.managed(target)?.include)) rows.push('removeSetup');
  if (report.editable && report.mode !== 'independent') rows.push('setIndependent');
  return rows;
}

export function panelItems(state: ThemeBridgePanelState, context: BridgePanelContext): PanelItem[] {
  const items: PanelItem[] = [{kind: 'switch'}];
  if (context.enabled) {
    items.push({kind: 'policy'});
    if (context.policy === 'choose') items.push({kind: 'globalTheme'});
  }
  items.push({kind: 'review'});
  for (const group of GROUPS) for (const target of BRIDGE_TARGETS.filter(id => BRIDGE_CAPABILITY[id] === group)) {
    items.push({kind: 'target', target});
    if (state.expanded === target) for (const row of detailRows(target, context.reports.find(report => report.target === target), context)) items.push({kind: 'detail', target, row});
  }
  return items;
}

const cycleRef = (themes: readonly SelectableTheme[], current: ThemeRef | undefined, delta: number) => {
  const index = themes.findIndex(theme => theme.ref === current);
  return themes[(index + delta + themes.length) % themes.length]?.ref;
};

export function themeBridgeKey(state: ThemeBridgePanelState, key: Key, context: BridgePanelContext): BridgePanelAction | undefined {
  state.message = undefined;
  if (state.review) {
    if (key.kind === 'left' || key.kind === 'right' || (key.kind === 'text' && (key.value === 'y' || key.value === 'n'))) {
      state.review.yes = key.kind === 'text' ? key.value === 'y' : !state.review.yes;
      return undefined;
    }
    if (key.kind === 'enter') {
      const yes = state.review.yes && state.review.items.some(item => item.action);
      state.review = undefined;
      if (yes) return {kind: 'applyAll'};
      state.message = 'Nothing was changed.';
      return undefined;
    }
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.review = undefined; state.message = 'Nothing was changed.'; }
    return undefined;
  }
  if (state.confirm) {
    const {kind, target} = state.confirm;
    if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'y')) {
      state.confirm = undefined;
      return kind === 'hook' ? {kind: 'confirmHook', target} : kind === 'batCache' ? {kind: 'confirmBat'} : {kind: 'confirmRemoval', target};
    }
    if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value.toLowerCase() === 'n')) {
      state.confirm = undefined;
      state.message = target === 'helix' && kind === 'hook' ? 'Nothing was changed. The generated theme stays available: run :theme nmsh-bridge inside Helix.' : 'Nothing was changed.';
    }
    return undefined;
  }
  const items = panelItems(state, context);
  state.selected = Math.max(0, Math.min(state.selected, items.length - 1));
  const item = items[state.selected]!;
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    // Esc collapses an expanded target first; it closes only when nothing is expanded.
    if (state.expanded) {
      const target = state.expanded;
      state.expanded = undefined;
      state.selected = Math.max(0, panelItems(state, context).findIndex(entry => entry.kind === 'target' && entry.target === target));
      return undefined;
    }
    return {kind: 'close'};
  }
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + items.length) % items.length; return undefined; }
  const delta = key.kind === 'left' ? -1 : key.kind === 'right' ? 1 : 0;
  const activate = key.kind === 'enter' || (key.kind === 'text' && key.value === ' ');
  if (item.kind === 'switch' && (delta || activate)) return {kind: 'setEnabled', enabled: !context.enabled};
  if (item.kind === 'policy' && (delta || activate)) {
    const policy = BRIDGE_POLICIES[(BRIDGE_POLICIES.indexOf(context.policy) + (delta || 1) + BRIDGE_POLICIES.length) % BRIDGE_POLICIES.length]!;
    return {kind: 'setPolicy', policy, ...(policy === 'choose' && !context.globalTheme && context.activeRef ? {theme: context.activeRef} : {})};
  }
  if (item.kind === 'globalTheme' && (delta || activate)) {
    const theme = cycleRef(context.themes, context.globalTheme, delta || 1);
    return theme ? {kind: 'setGlobalTheme', theme} : undefined;
  }
  if (item.kind === 'review' && activate) return {kind: 'reviewAll'};
  if (item.kind === 'target' && activate) {
    if (BRIDGE_CAPABILITY[item.target] === 'detected') {
      state.message = context.reports.find(report => report.target === item.target)?.notes[0] ?? 'Shown for status only; not managed by NMSh.';
      return undefined;
    }
    state.expanded = state.expanded === item.target ? undefined : item.target;
    return undefined;
  }
  if (item.kind === 'target' && delta) {
    const report = context.reports.find(entry => entry.target === item.target);
    if (!report?.editable) {
      state.message = BRIDGE_CAPABILITY[item.target] === 'detected' ? 'Shown for status only; not managed by NMSh.'
        : !context.enabled ? 'Theme Bridge is Off. Turn it On to apply themes.'
          : `Apply themes is ${BRIDGE_POLICY_LABELS[context.policy]}. Switch Apply themes to Manual to edit individual targets.`;
    } else state.message = 'Enter expands this tool\'s controls.';
    return undefined;
  }
  if (item.kind !== 'detail') return undefined;
  const {target, row} = item;
  const report = context.reports.find(entry => entry.target === target);
  if (row === 'mode' && (delta || activate)) {
    const modes = report?.modes ?? ['independent'];
    const mode = modes[(modes.indexOf(report?.mode ?? 'independent') + (delta || 1) + modes.length) % modes.length]!;
    // Choose theme starts on the pinned theme, or visibly on the active one; it never changes later by itself.
    const theme = mode === 'choose' ? context.pinned(target) ?? context.activeRef : undefined;
    return {kind: 'setMode', target, mode, ...(theme ? {theme} : {})};
  }
  if (row === 'theme' && (delta || activate)) {
    const theme = cycleRef(context.themes, context.pinned(target), delta || 1);
    return theme ? {kind: 'setMode', target, mode: 'choose', theme} : undefined;
  }
  if (!activate) return undefined;
  if (row === 'include') return {kind: 'planHook', target};
  if (row === 'reload') return {kind: 'reloadTmux'};
  if (row === 'batSetup' || row === 'batRebuild') return {kind: 'planBat', source: 'current'};
  if (row === 'batDuplicate') return {kind: 'planBat', source: 'duplicate'};
  if (row === 'removeSetup') return {kind: 'planRemoval', target};
  if (row === 'setIndependent') return {kind: 'setMode', target, mode: 'independent'};
  return undefined;
}

export function renderThemeBridgePanel(state: ThemeBridgePanelState, context: BridgePanelContext, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const warning = foreground(UI_COLORS.failure);
  const reset = '\u001B[0m';
  const finish = (rows: string[], controls: Array<[string, string]>) => {
    const budget = Math.max(3, height - 3);
    return framePanel([...rows.slice(0, budget), '', renderControls(controls)].map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
  };
  if (state.confirm) {
    const {kind, path, preview} = state.confirm;
    const title = kind === 'hook' ? 'Add include' : kind === 'batCache' ? 'Create bat theme and rebuild bat\'s cache' : 'Remove managed setup';
    const intro = kind === 'hook' ? 'This edits your config so new instances load NMSh-managed colors:'
      : kind === 'batCache' ? 'NMSh writes its own theme file, then runs bat cache --build (bat rebuilds its local theme cache) and checks bat --list-themes:'
        : 'This removes NMSh\'s managed file and exactly the NMSh lines it added:';
    return finish([`  ${primary}Theme Bridge › ${title}${reset}`, '', `  ${secondary}${intro}${reset}`, `  ${primary}${path}${reset}`, '',
      ...preview.map(line => `    ${line.startsWith('+') ? accent : line.startsWith('-') ? warning : subtle}${line}${reset}`), '',
      `  ${subtle}Nothing else changes. NMSh refuses to write if a file changes before you confirm.${reset}`], [['Enter', 'confirm'], ['Esc', 'cancel']]);
  }
  if (state.review) {
    const rows = [`  ${primary}Theme Bridge › Review all integrations${reset}`, ''];
    for (const item of state.review.items) {
      const glyph = item.action ? `${accent}+${reset}` : item.state === 'conflict' ? `${warning}!${reset}` : `${subtle}·${reset}`;
      rows.push(`  ${glyph} ${padCells(item.label, 22)}${item.action ? primary : subtle}${item.detail}${reset}`);
      for (const line of state.review.previews[item.target] ?? []) rows.push(`      ${line.startsWith('+') ? accent : subtle}${line}${reset}`);
    }
    const planned = state.review.items.filter(item => item.action).length;
    rows.push('', planned ? `  ${primary}Apply ${planned} reviewed change${planned === 1 ? '' : 's'}?  ${state.review.yes ? `${subtle}No${reset}  ${accent}‹ Yes ›${reset}` : `${accent}‹ No ›${reset}  ${subtle}Yes${reset}`}`
      : `  ${subtle}Everything is current; nothing to apply.${reset}`);
    return finish(rows, [['←→', 'No / Yes'], ['Enter', 'confirm'], ['Esc', 'back']]);
  }
  const items = panelItems(state, context);
  const selected = Math.max(0, Math.min(state.selected, items.length - 1));
  const isSelected = (index: number) => index === selected;
  const mark = (index: number) => isSelected(index) ? `${accent}${GLYPHS.selection}${reset}` : ' ';
  const value = (index: number, text: string) => isSelected(index) ? `${accent}‹ ${text} ›${reset}` : text;
  const lines: Array<{text: string; item?: number}> = [];
  lines.push({text: `  ${primary}Theme Bridge${reset}  ${subtle}extend NMSh themes to terminal tools · every tool starts Independent${reset}`}, {text: ''});
  let group: BridgeCapability | undefined;
  items.forEach((item, index) => {
    if (item.kind === 'switch') lines.push({item: index, text: `${mark(index)} ${isSelected(index) ? primary : secondary}${padCells('Theme Bridge', 16)}${reset}${value(index, context.enabled ? 'On' : 'Off')}  ${subtle}${context.enabled ? '' : 'nothing is applied; saved choices are kept'}${reset}`});
    else if (item.kind === 'policy') lines.push({item: index, text: `${mark(index)} ${isSelected(index) ? primary : secondary}${padCells('Apply themes', 16)}${reset}${value(index, BRIDGE_POLICY_LABELS[context.policy])}  ${subtle}${context.policy === 'manual' ? 'each tool uses its own setting' : 'every supported tool; their own settings are kept for Manual'}${reset}`});
    else if (item.kind === 'globalTheme') lines.push({item: index, text: `${mark(index)} ${isSelected(index) ? primary : secondary}${padCells('Theme', 16)}${reset}${value(index, context.globalThemeLabel ?? '—')}`});
    else if (item.kind === 'review') {
      lines.push({item: index, text: `${mark(index)} ${isSelected(index) ? primary : secondary}${padCells('Integrations', 16)}${reset}${isSelected(index) ? accent : subtle}Review all / Apply all ›${reset}`}, {text: ''});
      lines.push({text: `  ${subtle}  ${padCells('Target', 21)}${padCells('Mode', 15)}${padCells('Theme', 20)}Status${reset}`});
    } else if (item.kind === 'target') {
      const report = context.reports.find(entry => entry.target === item.target);
      const capability = BRIDGE_CAPABILITY[item.target];
      if (capability !== group) { group = capability; lines.push({text: `  ${subtle}${BRIDGE_CAPABILITY_LABELS[capability]}${reset}`}); }
      const detected = capability === 'detected';
      const mode = detected ? '—' : BRIDGE_MODE_LABELS[report?.mode ?? 'independent'];
      const theme = !detected && report && report.mode !== 'independent' ? report.themeLabel ?? '—' : '—';
      const status = [report?.status, report?.readiness, report?.inherited ? 'Inherited' : undefined].filter(Boolean).join(' · ');
      const expander = detected ? ' ' : state.expanded === item.target ? '▾' : '▸';
      lines.push({item: index, text: `${mark(index)} ${subtle}${expander}${reset} ${isSelected(index) ? primary : secondary}${padCells(report?.label ?? item.target, 19)}${reset}${padCells(mode, 15)}${padCells(truncateText(theme, 18), 20)}${subtle}${status}${reset}`});
      if (state.expanded === item.target && report) {
        if (!report.editable) lines.push({text: `      ${subtle}${!context.enabled ? 'Theme Bridge is Off.' : `Apply themes is ${BRIDGE_POLICY_LABELS[context.policy]}; switch it to Manual to edit this tool.`}${reset}`});
        if (report.backend) lines.push({text: `      ${subtle}Backend  ${report.backend}${reset}`});
        const managed = context.managed(item.target);
        if (managed?.artifact) lines.push({text: `      ${subtle}Managed  ${managed.artifact}${reset}`});
        if (managed?.include) lines.push({text: `      ${subtle}Include  ${managed.include}${reset}`});
        for (const note of report.notes.slice(0, 4)) lines.push({text: `      ${subtle}• ${note}${reset}`});
      }
    } else {
      const report = context.reports.find(entry => entry.target === item.target);
      const label = (text: string) => `${mark(index)}     ${isSelected(index) ? primary : secondary}${padCells(text, 18)}${reset}`;
      const act = (text: string) => `${isSelected(index) ? accent : subtle}${text}${reset}`;
      const include = context.managed(item.target)?.include;
      const text = item.row === 'mode' ? `${label('Mode')}${value(index, BRIDGE_MODE_LABELS[report?.mode ?? 'independent'])}`
        : item.row === 'theme' ? `${label('Theme')}${value(index, report?.themeLabel ?? 'Missing theme')}`
          : item.row === 'include' ? `${label(item.target === 'helix' || item.target === 'neovim' ? 'Activation' : 'Include')}${act(include ? 'configured · review ›' : 'review the exact one-time change ›')}`
            : item.row === 'reload' ? `${label('Reload')}${act('load into the running tmux server ›')}`
              : item.row === 'batSetup' ? `${label('Create for bat')}${act(`from ${report?.themeLabel ?? context.activeLabel ?? 'the current theme'} · review ›`)}`
                : item.row === 'batRebuild' ? `${label('Cache')}${act('rebuild bat\'s theme cache · review ›')}`
                  : item.row === 'batDuplicate' ? `${label('Duplicate → Custom')}${act('copy the source theme to an editable Custom theme for bat ›')}`
                    : item.row === 'removeSetup' ? `${label('Remove setup')}${act('remove NMSh\'s managed file and include · review ›')}`
                      : `${label('Set Independent')}${act('this tool only (Manual) ›')}`;
      lines.push({item: index, text});
    }
  });
  if (state.message) lines.push({text: ''}, {text: `  ${secondary}${state.message}${reset}`});
  // Keep the selection visible on short terminals: a window over the rows around it.
  const budget = Math.max(3, height - 3);
  const at = Math.max(0, lines.findIndex(line => line.item === selected));
  const start = lines.length <= budget ? 0 : Math.max(0, Math.min(at - Math.floor(budget / 2), lines.length - budget));
  const shown = lines.slice(start, start + budget).map(line => line.text);
  return finish(shown, [['↑↓', 'select'], ['←→', 'change'], ['Enter', state.expanded ? 'open / collapse' : 'expand'], ['Esc', state.expanded ? 'collapse' : 'close']]);
}
