import type {Key} from '../terminal/keys.js';
import {createConfirm, handleConfirmKey, renderConfirm, renderField, renderToggle, type ConfirmState} from '../ui/formControls.js';
import {framePanel} from '../ui/PanelShell.js';
import {colorLevel} from '../presentation/capabilities.js';
import {truncateAnsi} from '../util/text.js';
import type {ConfigReview, SupportedConfiguration} from './SupportedConfiguration.js';

export interface ConfigurationPanel {
  adapter: SupportedConfiguration;
  values: Readonly<Record<string, boolean>>;
  selected: number;
  busy: boolean;
  review?: ConfigReview;
  confirm: ConfirmState;
  message?: string;
}

export async function createConfigurationPanel(adapter: SupportedConfiguration): Promise<ConfigurationPanel> {
  return {adapter, values: await adapter.read(), selected: 0, busy: false, confirm: createConfirm()};
}

/** True closes; writes only after a prepared preview and shared confirmation. */
export async function configurationKey(state: ConfigurationPanel, key: Key): Promise<boolean> {
  if (state.busy) return false;
  if (key.kind === 'interrupt') key = {kind: 'escape'};
  if (state.review) {
    const result = handleConfirmKey(key, state.confirm);
    if (result === 'cancel') { state.review = undefined; return false; }
    if (result !== 'confirm') return false;
    state.busy = true;
    try {
      await state.review.apply();
      state.review = undefined;
      state.values = await state.adapter.read();
      state.message = 'Reviewed change saved.';
    } catch { state.review = undefined; state.message = 'Could not apply change. Review current configuration again.'; }
    finally { state.busy = false; }
  } else if (key.kind === 'escape') return true;
  else if (key.kind === 'up' || key.kind === 'down') {
    state.selected = Math.max(0, Math.min(state.adapter.fields.length - 1, state.selected + (key.kind === 'up' ? -1 : 1)));
  } else if (key.kind === 'enter') {
    const field = state.adapter.fields[state.selected];
    if (!field) return false;
    state.busy = true;
    try {
      state.review = await state.adapter.prepare(field.id, !state.values[field.id]);
      state.confirm = createConfirm();
      state.message = undefined;
    } catch { state.message = 'Could not prepare this change; original configuration was kept.'; }
    finally { state.busy = false; }
  }
  return false;
}

export function renderConfigurationPanel(state: ConfigurationPanel, columns: number, height: number): string[] {
  const color = colorLevel() !== 'none';
  const rows = [`  Configure ${state.adapter.label}`, ''];
  if (state.review) rows.push('  Review supported change', ...state.review.preview.map(line => `  ${line}`),
    '', renderConfirm(state.confirm, {color, focused: true}), '  Arrows choose; Enter apply/cancel; Esc cancel');
  else {
    const budget = Math.max(1, Math.floor((height - 7) / 2));
    const start = Math.max(0, state.selected - budget + 1);
    state.adapter.fields.slice(start, start + budget).forEach((field, index) => {
      const focused = index + start === state.selected;
      rows.push(...renderField({label: field.label, description: field.description, focused, color,
        control: renderToggle(state.values[field.id] === true, {focused, color})} , columns));
    });
    rows.push('  Up/Down select; Enter preview; Esc back');
  }
  if (state.message) rows.push(`  ${state.message}`);
  if (state.busy) rows.push('  Working...');
  return framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}
