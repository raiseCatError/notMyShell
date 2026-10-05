import type {Key} from '../terminal/keys.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {editText} from '../ui/formControls.js';
import {padCells, truncateAnsi} from '../util/text.js';
import {SOURCE_LABELS, type ScanResult} from './scan.js';
import type {DotfilesItem, ItemMode} from './plan.js';

/**
 * /dotfiles: source → (remote: confirm clone) → what NMSh understands, with
 * per-tool choices and per-field current-vs-dotfiles choices inline → one
 * combined review (default No) → per-item results. The panel holds the
 * draft choices only; scanning, cloning and applying are app actions.
 */
export interface DotfilesState {
  step: 'source' | 'clone' | 'items' | 'review' | 'result';
  source: string;
  scan?: ScanResult;
  items: DotfilesItem[];
  selected: number;
  expanded?: number;
  /** Selected field row inside the expanded item. */
  field: number;
  review?: {lines: string[]; yes: boolean};
  clone?: {url: string; target: string; yes: boolean};
  results: string[];
  message?: string;
}

export type DotfilesAction = {kind: 'close'} | {kind: 'scan'; source: string} | {kind: 'clone'} | {kind: 'review'} | {kind: 'apply'};

export function createDotfilesPanel(source = ''): DotfilesState {
  return {step: 'source', source, items: [], selected: 0, field: 0, results: []};
}

const MODE_LABELS: Record<ItemMode, string> = {import: 'Import supported settings', copy: 'Copy exact file', skip: 'Skip / keep current'};

export function dotfilesKey(state: DotfilesState, key: Key): DotfilesAction | undefined {
  state.message = undefined;
  if (state.step === 'source') {
    if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
    if (key.kind === 'enter') return state.source.trim() ? {kind: 'scan', source: state.source.trim()} : (state.message = 'Type a local path such as ~/dotfiles, or a Git URL.', undefined);
    const next = editText(state.source, key);
    if (next !== undefined) state.source = next.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').slice(0, 1024);
    return undefined;
  }
  const choose = (target: {yes: boolean}): 'yes' | 'no' | undefined => {
    if (key.kind === 'left' || key.kind === 'right') { target.yes = !target.yes; return undefined; }
    if (key.kind === 'enter') return target.yes ? 'yes' : 'no';
    if (key.kind === 'escape' || key.kind === 'interrupt') return 'no';
    return undefined;
  };
  if (state.step === 'clone' && state.clone) {
    const answer = choose(state.clone);
    if (answer === 'yes') return {kind: 'clone'};
    if (answer === 'no') { state.step = 'source'; state.clone = undefined; state.message = 'Nothing was downloaded.'; }
    return undefined;
  }
  if (state.step === 'review' && state.review) {
    const answer = choose(state.review);
    if (answer === 'yes') return {kind: 'apply'};
    if (answer === 'no') { state.step = 'items'; state.review = undefined; state.message = 'Nothing was changed.'; }
    return undefined;
  }
  if (state.step === 'result') return key.kind === 'escape' || key.kind === 'interrupt' || key.kind === 'enter' ? {kind: 'close'} : undefined;
  // items
  const item = state.items[state.selected];
  if (state.expanded !== undefined) {
    const fields = state.items[state.expanded]?.fields ?? [];
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.expanded = undefined; return undefined; }
    if (key.kind === 'up' || key.kind === 'down') { state.field = (state.field + (key.kind === 'up' ? -1 : 1) + fields.length) % Math.max(1, fields.length); return undefined; }
    const field = fields[state.field];
    if (field && (key.kind === 'left' || key.kind === 'right' || key.kind === 'enter' || (key.kind === 'text' && key.value === ' '))) field.use = !field.use;
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + state.items.length + 1) % (state.items.length + 1); return undefined; }
  if (state.selected === state.items.length) return key.kind === 'enter' ? {kind: 'review'} : undefined;
  if (!item) return undefined;
  if (key.kind === 'left' || key.kind === 'right') {
    const index = item.modes.indexOf(item.mode);
    item.mode = item.modes[(index + (key.kind === 'left' ? -1 : 1) + item.modes.length) % item.modes.length]!;
    return undefined;
  }
  if (key.kind === 'enter' && item.fields?.length) { state.expanded = state.selected; state.field = 0; }
  return undefined;
}

export function renderDotfilesPanel(state: DotfilesState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const warning = foreground(UI_COLORS.failure);
  const reset = '\u001B[0m';
  const yesNo = (yes: boolean) => yes ? `${subtle}No${reset}  ${accent}‹ Yes ›${reset}` : `${accent}‹ No ›${reset}  ${subtle}Yes${reset}`;
  const lines: string[] = [`  ${primary}Dotfiles import${reset}  ${subtle}supported settings only · nothing in the repository is run · the repository is not changed${reset}`, ''];
  let controls: Array<[string, string]> = [['Esc', 'close']];
  if (state.step === 'source') {
    lines.push(`  ${secondary}Source${reset}  ${primary}${state.source}${accent}_${reset}`, '',
      `  ${subtle}A local directory or Git checkout (plain, GNU Stow packages or a chezmoi source), or a Git URL (cloned only after you confirm).${reset}`);
    controls = [['Enter', 'scan'], ['Esc', 'close']];
  } else if (state.step === 'clone' && state.clone) {
    lines.push(`  ${primary}Clone ${state.clone.url}?${reset}`, `  ${subtle}into ${state.clone.target} · depth 1 · no submodules · Git hooks disabled · nothing in it is run${reset}`, '',
      `  ${primary}Download?${reset}  ${yesNo(state.clone.yes)}`);
    controls = [['←→', 'No / Yes'], ['Enter', 'confirm']];
  } else if (state.step === 'review' && state.review) {
    lines.push(`  ${primary}Dotfiles import plan${reset}`, '', ...state.review.lines.map(line => `  ${line.startsWith('  +') ? accent : line.startsWith('  ~') ? primary : subtle}${line}${reset}`), '',
      `  ${primary}Apply?${reset}  ${yesNo(state.review.yes)}`);
    controls = [['←→', 'No / Yes'], ['Enter', 'confirm'], ['Esc', 'back']];
  } else if (state.step === 'result') {
    lines.push(`  ${primary}Done${reset}`, '', ...state.results.map(line => `  ${secondary}• ${line}${reset}`), '', `  ${subtle}Edit imported tmux settings any time in /tmux.${reset}`);
    controls = [['Enter', 'close']];
  } else if (state.scan) {
    lines.push(`  ${secondary}Source${reset}  ${state.scan.root}`, `  ${secondary}Type${reset}    ${SOURCE_LABELS[state.scan.type]}${state.scan.packages.length ? ` · packages: ${state.scan.packages.join(', ')}` : ''}`);
    if (state.scan.scripts.length) lines.push(`  ${subtle}${state.scan.scripts.length} script${state.scan.scripts.length === 1 ? '' : 's'} found and never run (for example ${state.scan.scripts[0]})${reset}`);
    lines.push('', `  ${subtle}Found${reset}`);
    if (!state.items.length) lines.push(`  ${subtle}No configuration NMSh understands was found.${reset}`);
    state.items.forEach((item, index) => {
      const selected = index === state.selected && state.expanded === undefined;
      const glyph = item.kind === 'fields' || item.kind === 'copy' ? `${accent}✓${reset}` : item.kind === 'inspect' ? `${subtle}○${reset}` : `${warning}!${reset}`;
      lines.push(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${glyph} ${focusForeground(selected)}${padCells(item.file.tool.label, 10)}${reset}${padCells(item.file.repoPath, 32)}${selected && item.modes.length > 1 ? `${accent}‹ ${MODE_LABELS[item.mode]} ›${reset}` : MODE_LABELS[item.mode]}`);
      lines.push(`      ${subtle}${item.note}${item.fields?.length ? ' · Enter reviews each value' : ''}${reset}`);
      if (state.expanded === index && item.fields) {
        lines.push(`      ${subtle}${padCells('Setting', 24)}${padCells('Dotfiles', 16)}${padCells('Current', 16)}Use${reset}`);
        item.fields.forEach((field, fieldIndex) => {
          const on = fieldIndex === state.field;
          lines.push(`    ${on ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${padCells(field.label, 24)}${padCells(field.repo, 16)}${padCells(field.current, 16)}${on ? accent : field.conflict ? warning : subtle}${field.use ? 'Use dotfiles value' : 'Keep current value'}${reset}`);
        });
      }
    });
    const reviewSelected = state.selected === state.items.length && state.expanded === undefined;
    lines.push('', `${reviewSelected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${reviewSelected ? accent : subtle}Review all changes ›${reset}`);
    controls = state.expanded !== undefined ? [['↑↓', 'value'], ['←→', 'dotfiles / current'], ['Esc', 'back']] : [['↑↓', 'select'], ['←→', 'choose'], ['Enter', 'details / review'], ['Esc', 'close']];
  }
  if (state.message) lines.push('', `  ${secondary}${state.message}${reset}`);
  return framePanel([...lines.slice(0, Math.max(3, height - 3)), '', renderControls(controls)].map(line => truncateAnsi(line, columns)), columns).slice(0, Math.max(1, height));
}
