import type {Key} from '../../terminal/keys.js';
import {cycleTab, framePanel, renderTabStrip, tabCycleDelta} from '../../ui/PanelShell.js';
import {renderControls} from '../../ui/controls.js';
import {focusForeground, foreground, background, UI_COLORS} from '../../ui/palette.js';
import {GLYPHS} from '../../ui/glyphs.js';
import {editText} from '../../ui/formControls.js';
import {padCells, truncateAnsi} from '../../util/text.js';
import {
  applyTmuxChange, bindingConflicts, describeTmuxChange, optionProvenance, STATUS_MODULES, STATUS_SEPARATORS, TMUX_ACTION_IDS, TMUX_ACTIONS,
  TMUX_DEFAULT_BINDINGS, TMUX_OPTIONS, validTmuxKey, type StatusModuleId, type TmuxActionId, type TmuxChange, type TmuxImport, type TmuxModel,
  type TmuxStatusLayout,
} from './tmux.js';

/**
 * /tmux (also /configure tmux): tmux's Config Studio. It edits a draft of
 * the typed model; nothing is written until Review & apply shows every
 * change (and the one include, when missing) and the user picks Yes.
 * tmux appearance (Status Studio, Theme Bridge) and the pane frontend are
 * shown as different owners: NMSh's own prompt is configured in /prompt.
 */

export const TMUX_TABS = ['General', 'Keys', 'Status', 'Pane frontend', 'Import'] as const;
type Tab = 'general' | 'keys' | 'status' | 'frontend' | 'import';
const TAB_IDS: readonly Tab[] = ['general', 'keys', 'status', 'frontend', 'import'];

const PREFIXES = ['C-b', 'C-a', 'C-Space', 'C-s', 'C-q'] as const;
const LEFT_PRESETS: StatusModuleId[][] = [['session'], ['session', 'host'], ['host'], ['session', 'windowIndex'], []];
const RIGHT_PRESETS: StatusModuleId[][] = [['time'], ['date', 'time'], ['host', 'time'], ['paneCwd', 'time'], ['paneCommand', 'time'], []];
const KEY_ACTIONS: readonly TmuxActionId[] = TMUX_ACTION_IDS.filter(id => id !== 'send-prefix');

export interface TmuxPanelState {
  tab: Tab;
  focus: 'tabs' | 'list';
  selected: Record<Tab, number>;
  draft: TmuxModel;
  saved: TmuxModel;
  /** The user's own tmux.conf, parsed (supported subset), for provenance and import. */
  user?: TmuxImport;
  userPath?: string;
  /** Typing a key for a binding row. */
  keyEntry?: {action: TmuxActionId; text: string};
  review?: {lines: string[]; include: string[]; yes: boolean};
  /** Theme Bridge state for tmux, one line (owned by /theme-bridge). */
  bridge: string;
  installed: boolean;
  message?: string;
}

export type TmuxPanelAction = {kind: 'close'} | {kind: 'review'} | {kind: 'apply'} | {kind: 'reload'} | {kind: 'openPrompt'} | {kind: 'openBridge'};

export function createTmuxPanel(saved: TmuxModel, user: {path: string; parsed: TmuxImport} | undefined, bridge: string, installed: boolean): TmuxPanelState {
  return {tab: 'general', focus: 'list', selected: {general: 0, keys: 0, status: 0, frontend: 0, import: 0}, draft: structuredClone(saved), saved: structuredClone(saved),
    ...(user ? {user: user.parsed, userPath: user.path} : {}), bridge, installed};
}

/** Typed changes from saved to draft: what Review shows and what Apply writes. */
export function pendingChanges(state: Pick<TmuxPanelState, 'draft' | 'saved'>): TmuxChange[] {
  const changes: TmuxChange[] = [];
  for (const option of TMUX_OPTIONS) if (state.draft.options[option.id] !== state.saved.options[option.id]) changes.push({kind: 'option', id: option.id, ...(state.draft.options[option.id] !== undefined ? {value: state.draft.options[option.id]} : {})});
  if (state.draft.prefix !== state.saved.prefix) changes.push({kind: 'prefix', ...(state.draft.prefix ? {key: state.draft.prefix} : {})});
  const key = (binding: {key: string; table: string; action: string}) => `${binding.table}\u0000${binding.key}\u0000${binding.action}`;
  const saved = new Set(state.saved.bindings.map(key));
  const draft = new Set(state.draft.bindings.map(key));
  for (const binding of state.draft.bindings) if (!saved.has(key(binding)) && binding.action !== 'send-prefix') changes.push({kind: 'binding', binding});
  for (const binding of state.saved.bindings) if (!draft.has(key(binding)) && binding.action !== 'send-prefix') changes.push({kind: 'binding', binding, remove: true});
  if (JSON.stringify(state.draft.status) !== JSON.stringify(state.saved.status)) changes.push({kind: 'status', ...(state.draft.status ? {layout: state.draft.status} : {})});
  if (state.draft.frontend !== state.saved.frontend) changes.push({kind: 'frontend', value: state.draft.frontend});
  return changes;
}

type Row = {id: string; label: string; value: string; detail?: string; editable: boolean};

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = values.findIndex(value => JSON.stringify(value) === JSON.stringify(current));
  return values[(index + delta + values.length) % values.length]!;
}

function apply(state: TmuxPanelState, change: TmuxChange): void {
  const next = applyTmuxChange(state.draft, change);
  if ('error' in next) state.message = next.error; else state.draft = next;
}

function statusLayout(model: TmuxModel): TmuxStatusLayout {
  return model.status ?? {left: ['session'], right: ['time'], separator: '·', windowFormat: 'index-name'};
}

function rows(state: TmuxPanelState): Row[] {
  const draft = state.draft;
  if (state.tab === 'general' || state.tab === 'status') {
    const options = TMUX_OPTIONS.filter(option => state.tab === 'general' ? option.group !== 'Status' : option.group === 'Status');
    const list: Row[] = options.map(option => {
      const provenance = optionProvenance(option, draft, state.user);
      return {id: `option:${option.id}`, label: option.label, value: provenance.effective, editable: true,
        detail: `${provenance.source}${provenance.user !== undefined && provenance.override !== undefined && provenance.user !== provenance.override ? ` · your config: ${provenance.user}` : ''}${option.guidance ? ` · ${option.guidance}` : ''}`};
    });
    if (state.tab === 'status') {
      const layout = statusLayout(draft);
      const names = (ids: StatusModuleId[]) => ids.length ? ids.map(id => STATUS_MODULES[id].label).join(', ') : 'Nothing';
      list.push({id: 'studio', label: 'Status Studio', value: draft.status ? 'NMSh layout' : 'Inherit', editable: true, detail: draft.status ? 'NMSh writes the status formats below' : 'your config or tmux defaults keep the formats'});
      if (draft.status) {
        list.push({id: 'left', label: 'Left', value: names(layout.left), editable: true}, {id: 'right', label: 'Right', value: names(layout.right), editable: true},
          {id: 'separator', label: 'Separator', value: layout.separator, editable: true},
          {id: 'windows', label: 'Window labels', value: layout.windowFormat === 'index-name' ? 'Index:name' : layout.windowFormat === 'name' ? 'Name' : 'Index', editable: true});
      }
      list.push({id: 'bridge', label: 'Theme Bridge', value: state.bridge, editable: false, detail: 'colors come from /theme-bridge · Enter opens it'});
    }
    return [...list, {id: 'review', label: 'Review & apply', value: `${pendingChanges(state).length} change${pendingChanges(state).length === 1 ? '' : 's'} ›`, editable: false}];
  }
  if (state.tab === 'keys') {
    const prefix = draft.prefix ?? state.user?.prefix ?? 'C-b';
    const list: Row[] = [{id: 'prefix', label: 'Prefix', value: prefix, editable: true, detail: draft.prefix ? 'NMSh managed file' : state.user?.prefix ? 'your tmux config' : 'tmux default'}];
    for (const action of KEY_ACTIONS) {
      const mine = draft.bindings.find(binding => binding.action === action);
      const theirs = state.user?.bindings.find(binding => binding.action === action);
      const builtin = TMUX_DEFAULT_BINDINGS.find(binding => binding.action === action);
      const shown = mine ?? theirs ?? builtin;
      list.push({id: `bind:${action}`, label: TMUX_ACTIONS[action].label, editable: true,
        value: shown ? `${shown.table === 'root' ? '' : 'prefix '}${shown.key}` : '—',
        detail: mine ? 'NMSh binding · Del removes it' : theirs ? 'your tmux config' : builtin ? 'tmux default' : 'not bound · Enter adds one'});
    }
    const conflicts = bindingConflicts(draft, state.user);
    if (conflicts.length) list.push({id: 'conflicts', label: 'Overrides', value: `${conflicts.length} of your bindings`, editable: false, detail: conflicts.map(item => `${item.user.key}: ${TMUX_ACTIONS[item.user.action].label} → ${TMUX_ACTIONS[item.binding.action].label}`).join(' · ')});
    return [...list, {id: 'review', label: 'Review & apply', value: `${pendingChanges(state).length} change${pendingChanges(state).length === 1 ? '' : 's'} ›`, editable: false}];
  }
  if (state.tab === 'frontend') {
    return [
      {id: 'frontend', label: 'New panes', value: draft.frontend === 'nmsh' ? 'Start NMSh' : 'Start normal shell', editable: true,
        detail: 'Applies to new panes and windows without an explicit command. Existing panes keep their current process. tmux\'s default-shell is not changed.'},
      {id: 'prompt', label: 'NMSh prompt', value: 'Configure in /prompt ›', editable: false, detail: 'The real NMSh prompt, composer and theme run inside the pane; they are configured once, in /prompt'},
      {id: 'review', label: 'Review & apply', value: `${pendingChanges(state).length} change${pendingChanges(state).length === 1 ? '' : 's'} ›`, editable: false},
    ];
  }
  const user = state.user;
  return [
    {id: 'source', label: 'Your tmux config', value: state.userPath ?? 'none found', editable: false},
    {id: 'found', label: 'Supported values', value: user ? `${Object.keys(user.options).length} settings · ${user.prefix ? 'prefix · ' : ''}${user.bindings.length} bindings` : '—', editable: false},
    {id: 'skipped', label: 'Left as yours', value: user ? `${user.unsupported.length} other lines · ${user.ignored.length} dynamic (never run)` : '—', editable: false,
      detail: user?.ignored.length ? `not evaluated: ${user.ignored.slice(0, 3).join(' · ')}` : undefined},
    {id: 'copy', label: 'Copy into NMSh', value: 'Copy supported values into the NMSh managed file ›', editable: false,
      detail: 'Makes them editable here; your tmux.conf is not changed'},
    {id: 'review', label: 'Review & apply', value: `${pendingChanges(state).length} change${pendingChanges(state).length === 1 ? '' : 's'} ›`, editable: false},
  ];
}

export function tmuxPanelKey(state: TmuxPanelState, key: Key): TmuxPanelAction | undefined {
  state.message = undefined;
  if (state.review) {
    if (key.kind === 'left' || key.kind === 'right') { state.review.yes = !state.review.yes; return undefined; }
    if (key.kind === 'enter') {
      const yes = state.review.yes;
      state.review = undefined;
      if (yes) return {kind: 'apply'};
      state.message = 'Nothing was changed.';
      return undefined;
    }
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.review = undefined; state.message = 'Nothing was changed.'; }
    return undefined;
  }
  if (state.keyEntry) {
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.keyEntry = undefined; return undefined; }
    if (key.kind === 'enter') {
      const text = state.keyEntry.text.trim();
      if (!validTmuxKey(text)) { state.message = `${text || '(empty)'} is not a key NMSh can bind (examples: C-a, M-Left, F5, |).`; return undefined; }
      apply(state, {kind: 'binding', binding: {key: text, table: /^M-|^F\d/u.test(text) ? 'root' : 'prefix', action: state.keyEntry.action}});
      state.keyEntry = undefined;
      return undefined;
    }
    const next = editText(state.keyEntry.text, key);
    if (next !== undefined) state.keyEntry.text = next.slice(0, 16);
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  const tabStep = tabCycleDelta(key);
  if (tabStep) { state.tab = cycleTab(TAB_IDS, state.tab, tabStep); return undefined; }
  if (state.focus === 'tabs') {
    if (key.kind === 'left' || key.kind === 'right') state.tab = TAB_IDS[(TAB_IDS.indexOf(state.tab) + (key.kind === 'left' ? -1 : 1) + TAB_IDS.length) % TAB_IDS.length]!;
    else if (key.kind === 'down' || key.kind === 'enter') state.focus = 'list';
    return undefined;
  }
  const list = rows(state);
  const index = Math.max(0, Math.min(state.selected[state.tab], list.length - 1));
  if (key.kind === 'up' || key.kind === 'down') {
    if (key.kind === 'up' && index === 0) { state.focus = 'tabs'; return undefined; }
    state.selected[state.tab] = Math.max(0, Math.min(list.length - 1, index + (key.kind === 'up' ? -1 : 1)));
    return undefined;
  }
  const row = list[index]!;
  const delta = key.kind === 'left' ? -1 : key.kind === 'right' ? 1 : 0;
  if (!delta && !row.editable && key.kind !== 'enter') return undefined;
  if (row.id === 'review' && key.kind === 'enter') return pendingChanges(state).length ? {kind: 'review'} : (state.message = 'Nothing to apply; NMSh can reload tmux with R.', undefined);
  if (row.id === 'prompt' && key.kind === 'enter') return {kind: 'openPrompt'};
  if (row.id === 'bridge' && key.kind === 'enter') return {kind: 'openBridge'};
  if (row.id === 'copy' && key.kind === 'enter') {
    if (!state.user) { state.message = 'No tmux config was found to copy from.'; return undefined; }
    for (const [id, value] of Object.entries(state.user.options)) apply(state, {kind: 'option', id, value});
    if (state.user.prefix) apply(state, {kind: 'prefix', key: state.user.prefix});
    for (const binding of state.user.bindings) apply(state, {kind: 'binding', binding});
    state.message = 'Copied into the draft; Review & apply shows every change before anything is written.';
    return undefined;
  }
  if (key.kind === 'text' && key.value.toLowerCase() === 'r' && !row.id.startsWith('bind:')) return {kind: 'reload'};
  if (row.id.startsWith('option:')) {
    const option = TMUX_OPTIONS.find(item => item.id === row.id.slice(7))!;
    if ((key.kind === 'delete' || key.kind === 'backspace')) { apply(state, {kind: 'option', id: option.id}); state.message = `${option.label}: inherit`; return undefined; }
    if (!delta && key.kind !== 'enter') return undefined;
    const current = state.draft.options[option.id] ?? optionProvenance(option, state.draft, state.user).effective;
    const next = option.values ? cycle(option.values, current, delta || 1)
      : String(Math.max(option.range![0], Math.min(option.range![1], Number(current) + (delta || 1) * (option.range![1] > 10_000 ? 10_000 : option.range![1] > 100 ? 10 : 1))));
    apply(state, {kind: 'option', id: option.id, value: next});
    return undefined;
  }
  if (row.id === 'prefix') {
    if (key.kind === 'delete' || key.kind === 'backspace') { apply(state, {kind: 'prefix'}); return undefined; }
    if (delta || key.kind === 'enter') apply(state, {kind: 'prefix', key: cycle(PREFIXES, (state.draft.prefix ?? 'C-b') as typeof PREFIXES[number], delta || 1)});
    return undefined;
  }
  if (row.id.startsWith('bind:')) {
    const action = row.id.slice(5) as TmuxActionId;
    const mine = state.draft.bindings.find(binding => binding.action === action);
    if ((key.kind === 'delete' || key.kind === 'backspace') && mine) { apply(state, {kind: 'binding', binding: mine, remove: true}); return undefined; }
    if (key.kind === 'enter') state.keyEntry = {action, text: mine?.key ?? ''};
    return undefined;
  }
  const layout = statusLayout(state.draft);
  if (row.id === 'studio' && (delta || key.kind === 'enter')) { apply(state, {kind: 'status', ...(state.draft.status ? {} : {layout})}); return undefined; }
  if (row.id === 'left' && (delta || key.kind === 'enter')) apply(state, {kind: 'status', layout: {...layout, left: cycle(LEFT_PRESETS, layout.left, delta || 1)}});
  else if (row.id === 'right' && (delta || key.kind === 'enter')) apply(state, {kind: 'status', layout: {...layout, right: cycle(RIGHT_PRESETS, layout.right, delta || 1)}});
  else if (row.id === 'separator' && (delta || key.kind === 'enter')) apply(state, {kind: 'status', layout: {...layout, separator: cycle(STATUS_SEPARATORS, layout.separator, delta || 1)}});
  else if (row.id === 'windows' && (delta || key.kind === 'enter')) apply(state, {kind: 'status', layout: {...layout, windowFormat: cycle(['index-name', 'name', 'index'] as const, layout.windowFormat, delta || 1)}});
  else if (row.id === 'frontend' && (delta || key.kind === 'enter')) apply(state, {kind: 'frontend', value: state.draft.frontend === 'nmsh' ? 'shell' : 'nmsh'});
  return undefined;
}

/** A tmux-style status line preview, drawn with NMSh's own UI roles (facts are samples, never probed). */
export function statusPreview(model: TmuxModel, columns: number): string {
  const layout = statusLayout(model);
  const sample: Record<StatusModuleId, string> = {session: 'main', windowIndex: '1', windowName: 'nvim', paneIndex: '0', paneCommand: 'nvim', paneCwd: 'notMyShell', host: 'host', date: '2026-10-05', time: '14:32'};
  const join = (ids: StatusModuleId[]) => ids.length ? ` ${ids.map(id => sample[id]).join(` ${layout.separator} `)} ` : '';
  const window = (index: number, name: string) => layout.windowFormat === 'name' ? ` ${name} ` : layout.windowFormat === 'index' ? ` ${index} ` : ` ${index}:${name} `;
  const reset = '\u001B[0m';
  const bar = `${background(UI_COLORS.projectBackground)}${foreground(UI_COLORS.projectForeground)}`;
  const left = `${bar}${join(layout.left)}${reset}`;
  const windows = `${foreground(UI_COLORS.secondary)}${window(1, 'zsh')}${reset}${background(UI_COLORS.selection)}${foreground(UI_COLORS.primary)}${window(2, 'nvim')}${reset}`;
  const right = `${foreground(UI_COLORS.secondary)}${join(layout.right)}${reset}`;
  return truncateAnsi(`  ${left}${windows}  ${right}`, columns);
}

export function renderTmuxPanel(state: TmuxPanelState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const finish = (lines: string[], controls: Array<[string, string]>) =>
    framePanel([...lines.slice(0, Math.max(3, height - 3)), '', renderControls(controls)].map(line => truncateAnsi(line, columns)), columns).slice(0, Math.max(1, height));
  if (state.review) {
    const lines = [`  ${primary}tmux › Review${reset}`, '', `  ${secondary}NMSh writes only its managed tmux file:${reset}`,
      ...state.review.lines.map(line => `    ${accent}+${reset} ${line}`)];
    if (state.review.include.length) lines.push('', `  ${secondary}tmux.conf does not load it yet; this one include is added:${reset}`, ...state.review.include.map(line => `    ${line.startsWith('+') ? accent : subtle}${line}${reset}`));
    lines.push('', `  ${subtle}Your other tmux settings are untouched. New servers load it; a running server needs Reload.${reset}`, '',
      `  ${primary}Apply?${reset}  ${state.review.yes ? `${subtle}No${reset}  ${accent}‹ Yes ›${reset}` : `${accent}‹ No ›${reset}  ${subtle}Yes${reset}`}`);
    return finish(lines, [['←→', 'No / Yes'], ['Enter', 'confirm'], ['Esc', 'back']]);
  }
  const head = [`  ${primary}tmux${reset}  ${subtle}${state.installed ? 'Tool Configuration · NMSh writes one managed file your tmux.conf includes' : 'not installed · settings are kept for when it is'}${reset}`,
    renderTabStrip(TMUX_TABS, TAB_IDS.indexOf(state.tab), columns, state.focus === 'tabs'), ''];
  const list = rows(state);
  const index = Math.max(0, Math.min(state.selected[state.tab], list.length - 1));
  const body: string[] = [];
  list.forEach((row, rowIndex) => {
    const selected = state.focus === 'list' && rowIndex === index;
    const value = state.keyEntry && row.id === `bind:${state.keyEntry.action}` ? `${primary}${state.keyEntry.text}${accent}_${reset}` : selected && row.editable ? `${accent}‹ ${row.value} ›${reset}` : row.value;
    body.push(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${focusForeground(selected)}${padCells(row.label, 24)}${reset}${value}`);
    if (selected && row.detail) body.push(`    ${subtle}${row.detail}${reset}`);
  });
  if (state.tab === 'status') body.push('', `  ${subtle}Preview · tmux status line (sample facts)${reset}`, statusPreview(state.draft, columns));
  if (state.tab === 'frontend') body.push('', `  ${subtle}tmux appearance (status line, borders) and the pane frontend are different owners: the prompt inside a pane belongs to the program running there.${reset}`);
  if (state.message) body.push('', `  ${secondary}${state.message}${reset}`);
  return finish([...head, ...body], state.focus === 'tabs' ? [['←→', 'tabs'], ['↓', 'select'], ['Esc', 'close']]
    : [['↑↓', 'select'], ['←→', 'change'], ['Enter', 'edit / open'], ['Del', 'inherit'], ['R', 'reload tmux'], ['Esc', 'close']]);
}

export {describeTmuxChange};
