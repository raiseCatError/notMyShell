import type {Key} from '../terminal/keys.js';
import {createConfirm, handleConfirmKey, renderConfirm, editText, type ConfirmState} from '../ui/formControls.js';
import {framePanel} from '../ui/PanelShell.js';
import {displayWidth, truncateAnsi} from '../util/text.js';
import {colorLevel} from '../presentation/capabilities.js';
import {presetCommands, presetNeedsAcknowledgement, type SessionPreset} from './SessionPresets.js';

export interface PresetPanel {
  presets: SessionPreset[]; selected: number; detail?: SessionPreset;
  form?: {name: string; cwd: string; commands: string; field: number};
  confirm?: ConfirmState; operation?: 'launch' | 'delete'; scroll: number; message?: string;
}
export type PresetAction = 'close' | 'create' | 'delete' | 'launch';
export function createPresetPanel(presets: SessionPreset[]): PresetPanel { return {presets, selected:0, scroll:0}; }
export function presetPanelKey(state: PresetPanel, key: Key, cwd: string): PresetAction | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (state.confirm) { state.confirm = undefined; state.operation = undefined; }
    else if (state.form) state.form = undefined;
    else if (state.detail) { state.detail = undefined; state.scroll = 0; }
    else return 'close';
    return;
  }
  if (state.confirm) {
    if (key.kind === 'pageUp' || key.kind === 'pageDown') { state.scroll = Math.max(0,state.scroll + (key.kind === 'pageUp' ? -5 : 5)); return; }
    const decision = handleConfirmKey(key,state.confirm);
    if (decision === 'cancel') { state.confirm = undefined; state.operation = undefined; }
    if (decision === 'confirm') { const action = state.operation; state.confirm = undefined; state.operation = undefined; return action; }
    return;
  }
  if (state.form) {
    if (key.kind === 'complete') state.form.field = (state.form.field + 1) % 3;
    else if (key.kind === 'enter') return 'create';
    else {
      const field = (['name','cwd','commands'] as const)[state.form.field]!;
      if (key.kind === 'newline' && field === 'commands') state.form.commands += '\n';
      else { const value = editText(state.form[field],key); if (value !== undefined) state.form[field] = value; }
    }
    return;
  }
  if (state.detail) {
    if (key.kind === 'up' || key.kind === 'down' || key.kind === 'pageUp' || key.kind === 'pageDown') state.scroll = Math.max(0,state.scroll + (key.kind === 'up' || key.kind === 'pageUp' ? -1 : 1));
    if (key.kind === 'text') {
      if (key.value.toLowerCase() === 'l') {
        state.operation = 'launch'; state.scroll = 0;
        if (presetNeedsAcknowledgement(state.detail)) state.confirm = createConfirm();
        else { state.operation = undefined; return 'launch'; }
      } else if (key.value.toLowerCase() === 'd') { state.operation = 'delete'; state.confirm = createConfirm(); }
    }
    return;
  }
  if (key.kind === 'text' && key.value.toLowerCase() === 'n') { state.form = {name:'',cwd,commands:'',field:0}; state.message = undefined; }
  else if (key.kind === 'up' || key.kind === 'down') state.selected = Math.max(0,Math.min(state.presets.length-1,state.selected + (key.kind === 'up' ? -1 : 1)));
  else if (key.kind === 'enter') { state.detail = state.presets[state.selected]; state.scroll = 0; state.message = undefined; }
}

/** Wrap every command character so inspection/acknowledgement can scroll without elision. */
export function presetReviewRows(preset: SessionPreset, width: number): string[] {
  const rows: string[] = [];
  for (const command of presetCommands(preset)) {
    for (const line of command.split('\n')) {
      let row = '';
      for (const char of line.replace(/\t/gu,'    ')) {
        if (row && displayWidth(row+char) > Math.max(2,width)) { rows.push(row); row = ''; }
        row += char;
      }
      rows.push(row);
    }
    rows.push('');
  }
  return rows;
}

export function renderPresetPanel(state: PresetPanel, columns: number, height: number): string[] {
  state.selected = Math.max(0,Math.min(state.selected,state.presets.length-1));
  const header = ['  Session presets — create a new live real-zsh session'];
  const body: string[] = [], footer: string[] = [];
  if (state.form) {
    header.push('  Explicit startup commands only; never put secrets here.');
    body.push(...(['name','cwd','commands'] as const).map((field,i)=>`  ${state.form!.field === i ? '>' : ' '} ${field}: ${state.form![field].replace(/\n/gu, ' | ') || '_'}`));
    footer.push('  Tab fields; Ctrl+J adds command line; Enter create; Esc cancel', '  Commands: one shell command per line. Environment values are not captured.');
  } else if (state.detail) {
    header.push(`  ${state.detail.name} / ${state.detail.cwd}`);
    if (state.operation === 'delete') {
      body.push('  Delete this preset? Live sessions are unaffected.');
    } else {
      header.push(state.operation === 'launch' ? '  Review startup commands before launching:' : '  Stored startup commands (read-only):');
      body.push(...presetReviewRows(state.detail,columns-4).map(row=>`  ${row}`));
    }
    if (state.confirm) footer.push(renderConfirm(state.confirm,{focused:true,color:colorLevel() !== 'none'}), '  Arrows choose; Enter confirms; PgUp/PgDn review; Esc cancel');
    else footer.push('  L launch NEW session; D delete; Up/Down review; Esc back');
    if (state.operation !== 'delete') footer.push('  Existing live session stays detached; reattach it with /resume.');
  } else {
    body.push(...state.presets.map((preset,i)=>`  ${state.selected === i ? '>' : ' '} ${preset.name} / ${preset.cwd}`));
    if (!state.presets.length) body.push('  No presets. N creates one.');
    footer.push('  N create; Up/Down choose; Enter inspect; Esc back');
  }
  if (state.message) footer.push(`  ${state.message}`);
  const budget = Math.max(1,height-header.length-footer.length-2);
  const start = state.detail ? Math.min(state.scroll,Math.max(0,body.length-budget)) : Math.max(0,state.selected-budget+1);
  if (state.detail) state.scroll = start;
  const rows = [...header,...body.slice(start,start+budget),...footer];
  return framePanel(rows.map(row=>truncateAnsi(row,columns)),columns).slice(0,Math.max(1,height));
}
