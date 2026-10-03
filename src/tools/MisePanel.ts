import type {Key} from '../terminal/keys.js';
import {createConfirm, handleConfirmKey, renderConfirm, type ConfirmState} from '../ui/formControls.js';
import {framePanel} from '../ui/PanelShell.js';
import {truncateAnsi} from '../util/text.js';
import {colorLevel} from '../presentation/capabilities.js';
import {miseTaskCommand, type MiseProject, type MiseResult} from './MiseProject.js';

export interface MisePanel {project: MiseProject; result?: MiseResult; selected: number; confirm?: ConfirmState; busy?: boolean}
export function misePanelKey(state: MisePanel, key: Key): 'close' | 'inspect' | {command: string} | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (state.confirm) state.confirm = undefined;
    else return 'close';
    return;
  }
  if (state.busy) return;
  if (state.confirm) {
    const decision = handleConfirmKey(key, state.confirm);
    if (decision === 'confirm' || decision === 'cancel') state.confirm = undefined;
    if (decision === 'confirm') return 'inspect';
    return;
  }
  if (key.kind === 'text' && /^[ir]$/iu.test(key.value) && state.project.binary) state.confirm = createConfirm();
  const tasks = state.result?.state === 'available' ? state.result.metadata.tasks : [];
  if (key.kind === 'up' || key.kind === 'down') state.selected = Math.max(0, Math.min(tasks.length - 1, state.selected + (key.kind === 'up' ? -1 : 1)));
  if (key.kind === 'enter' && tasks[state.selected]) return {command: miseTaskCommand(tasks[state.selected]!)};
}
export function renderMisePanel(state: MisePanel, columns: number, height: number): string[] {
  const rows = ['  mise project awareness', `  ${state.project.binary ? 'Installed' : 'mise missing; NMSh works without it'}`,
    `  ${state.project.marker ? 'Project config detected (not evaluated)' : 'No standard project marker detected'}`];
  if (state.confirm) rows.push('  Inspect mise metadata for this directory?', '  Config templates may execute commands; remote tasks may be fetched.',
    '  Runs: mise ls --current --json; mise tasks ls --json', '  This does not grant trust or change shell hooks.',
    renderConfirm(state.confirm, {focused: true, color: colorLevel() !== 'none'}), '  Arrows choose; Enter confirms; Esc cancels');
  else if (state.busy) rows.push('  Inspecting metadata; Esc cancels.');
  else {
    rows.push(`  ${state.result?.state === 'available' ? 'Metadata available' : state.result?.state === 'failed' ? 'Metadata inspection failed' : 'Metadata not yet inspected'}`);
    if (state.result?.state === 'available') {
      rows.push(`  Tools: ${state.result.metadata.tools.map(tool => `${tool.name} ${tool.version}`).join(', ') || 'none reported'}`);
      const tasks = state.result.metadata.tasks;
      rows.push('  Tasks may run project actions/install tools.', '  Enter fills composer only; separate Enter runs in real zsh.');
      const budget = Math.max(1, height - 11), start = Math.max(0, state.selected - budget + 1);
      rows.push(...tasks.slice(start, start + budget).map((name, i) => `  ${start + i === state.selected ? '>' : ' '} ${name}`));
      if (!tasks.length) rows.push('  No tasks reported.');
    }
    rows.push('  I inspect / R refresh (requires consent); Up/Down tasks; Esc back');
  }
  return framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}
