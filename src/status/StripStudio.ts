import type {Key} from '../terminal/keys.js';
import {STRIP_ZONES, type ContextModuleConfig, type PromptConfiguration, type StatusStripSettings, type StripZone} from '../prompt/configuration.js';
import {adjustSettingsRow, settingsRowValue, SETTINGS_ROWS, toggleSettingsRow, type SettingsRow} from '../ui/SettingsPanel.js';
import {moduleDefinition} from '../context/modules.js';
import {routeModule, surfaceAvailability} from '../context/surfaceRouter.js';
import {safeContextText} from '../context/facts.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControlRows} from '../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {padCells, truncateAnsi} from '../util/text.js';

/**
 * /strip and /status-strip: the Status Strip Studio. It composes the one strip
 * row — on/off, edge, style, separator, where the system items sit, which of
 * them show, and the group and order of modules routed to the strip — with a
 * live preview painted by the same renderer as the real row. Strip options
 * are the canonical Settings rows (Config shows the same values); /modules
 * decides which modules go to the strip. Every change applies at once, like
 * Config; a preset is previewed with what it would change before Enter applies
 * it, and U undoes the last applied preset.
 */

export type StripPresetId = 'minimal' | 'developer' | 'system';
export const STRIP_PRESETS: ReadonlyArray<{id: StripPresetId; label: string}> = [
  {id: 'minimal', label: 'Minimal'}, {id: 'developer', label: 'Developer'}, {id: 'system', label: 'System'}];

/** Developer routes these non-sensitive modules to the strip; cloud and agent modules are never touched by a preset. */
const DEVELOPER_MODULES: ReadonlyArray<{id: string; zone: StripZone}> = [
  {id: 'cwd', zone: 'left'}, {id: 'gitBranch', zone: 'left'}, {id: 'toolchain', zone: 'left'}, {id: 'shell', zone: 'right'}];

const PRESET_NATIVE: Record<StripPresetId, Partial<StatusStripSettings>> = {
  minimal: {clock: true, battery: true, cpu: false, ram: false, uptime: false, style: 'plain', separator: 'dot', nativeZone: 'right'},
  developer: {clock: true, battery: true, cpu: false, ram: true, uptime: false, ramDisplay: 'percent', style: 'plain', separator: 'dot', nativeZone: 'right'},
  system: {clock: true, battery: true, cpu: true, ram: true, uptime: true, ramDisplay: 'percent', style: 'plain', separator: 'bar', nativeZone: 'right'},
};

const onStrip = (module: ContextModuleConfig) => routeModule(module) === 'statusStrip';

/** A preset's result. Presets change strip items and style; Developer also routes its listed modules to the strip, nothing else. */
export function applyStripPreset(configuration: PromptConfiguration, id: StripPresetId): PromptConfiguration {
  const next = structuredClone(configuration);
  next.statusStrip = {...next.statusStrip, ...PRESET_NATIVE[id], enabled: next.statusStrip.enabled};
  if (id === 'developer') {
    for (const {id: moduleId, zone} of DEVELOPER_MODULES) {
      const module = next.modules.find(item => item.id === moduleId);
      if (!module || !moduleDefinition(moduleId)?.supportedSurfaces.includes('statusStrip')) continue;
      module.visible = true;
      module.surface = 'statusStrip';
      module.stripZone = zone;
    }
  }
  return next;
}

/** The preset the current settings match, or Custom after manual edits. */
export function matchingStripPreset(configuration: PromptConfiguration): StripPresetId | 'custom' {
  for (const {id} of STRIP_PRESETS) {
    const native = Object.entries(PRESET_NATIVE[id]).every(([key, value]) => configuration.statusStrip[key as keyof StatusStripSettings] === value);
    const routed = id !== 'developer' || DEVELOPER_MODULES.every(({id: moduleId, zone}) => {
      const module = configuration.modules.find(item => item.id === moduleId);
      return module && onStrip(module) && (module.stripZone ?? 'right') === zone;
    });
    const strayRouting = id === 'minimal' && configuration.modules.some(onStrip) ? false : true;
    if (native && routed && strayRouting) return id;
  }
  return 'custom';
}

/** What applying a preset would change, in words, so nothing about it is hidden. */
export function stripPresetChanges(configuration: PromptConfiguration, id: StripPresetId): string[] {
  const next = applyStripPreset(configuration, id);
  const changes: string[] = [];
  const items = (settings: StatusStripSettings) => ['clock', 'battery', 'cpu', 'ram', 'uptime'].filter(key => settings[key as keyof StatusStripSettings]).join(', ') || 'none';
  if (items(configuration.statusStrip) !== items(next.statusStrip)) changes.push(`System items: ${items(next.statusStrip)}`);
  if (configuration.statusStrip.style !== next.statusStrip.style || configuration.statusStrip.separator !== next.statusStrip.separator) {
    changes.push(`Style: ${next.statusStrip.style === 'powerline' ? 'Powerline' : next.statusStrip.separator === 'bar' ? 'Divided (│)' : next.statusStrip.separator === 'space' ? 'Plain, spaced' : 'Minimal (·)'}`);
  }
  if (configuration.statusStrip.nativeZone !== next.statusStrip.nativeZone) changes.push(`System items move ${next.statusStrip.nativeZone}`);
  for (const module of next.modules) {
    const before = configuration.modules.find(item => item.id === module.id);
    if (!before || (onStrip(before) && (before.stripZone ?? 'right') === module.stripZone) || !onStrip(module)) continue;
    const from = routeModule({...before, visible: true});
    changes.push(`${moduleDefinition(module.id)?.label ?? module.id}: to the strip (${module.stripZone})${before.visible && from !== 'hidden' && from !== 'statusStrip' ? `, leaving ${from === 'mainPrompt' ? 'the Main Prompt' : from === 'rightContext' ? 'Right Context' : 'the Context Rail'}` : ''}`);
  }
  return changes.length ? changes : ['Nothing: the strip already matches'];
}

type StudioRow = {kind: 'preset'} | {kind: 'setting'; row: SettingsRow} | {kind: 'module'; module: ContextModuleConfig};

export interface StripStudioState {
  selected: number;
  /** A preset being previewed; Enter applies it, moving away cancels it. */
  pending?: StripPresetId;
  /** The configuration before the last applied preset, for U. */
  undo?: PromptConfiguration;
  message?: string;
}

export function createStripStudio(): StripStudioState { return {selected: 0}; }

const SETTING_IDS = ['statusStrip', 'stripEdge', 'stripStyle', 'stripSeparator', 'stripNativeZone', 'stripClock', 'stripBattery', 'stripCpu', 'stripRam', 'stripRamDisplay', 'stripUptime'];

/** Strip-routed modules in strip order (the shared module order). */
export function stripModules(configuration: PromptConfiguration): ContextModuleConfig[] {
  return configuration.modules.filter(module => module.visible && onStrip(module));
}

function rows(configuration: PromptConfiguration): StudioRow[] {
  const settings = SETTING_IDS.map(id => SETTINGS_ROWS.find(row => row.id === id)).filter((row): row is SettingsRow => Boolean(row) && (row!.when?.(configuration) ?? true));
  return [...(configuration.statusStrip.enabled ? [{kind: 'preset' as const}] : []), ...settings.map(row => ({kind: 'setting' as const, row})),
    ...(configuration.statusStrip.enabled ? stripModules(configuration).map(module => ({kind: 'module' as const, module})) : [])];
}

export type StripStudioAction = {kind: 'close'} | {kind: 'change'; configuration: PromptConfiguration};

export function stripStudioKey(state: StripStudioState, key: Key, configuration: PromptConfiguration): StripStudioAction | undefined {
  const visible = rows(configuration);
  state.selected = Math.max(0, Math.min(state.selected, visible.length - 1));
  state.message = undefined;
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (state.pending) { state.pending = undefined; state.message = 'Preset preview cancelled; nothing changed.'; return undefined; }
    return {kind: 'close'};
  }
  if (key.kind === 'text' && /^[uU]$/u.test(key.value)) {
    if (!state.undo) { state.message = 'No preset to undo.'; return undefined; }
    const previous = state.undo;
    state.undo = undefined;
    state.message = 'Preset undone.';
    return {kind: 'change', configuration: previous};
  }
  if (key.kind === 'up' || key.kind === 'down') {
    state.pending = undefined;
    state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + visible.length) % visible.length;
    return undefined;
  }
  const row = visible[state.selected];
  if (!row) return undefined;
  if (row.kind === 'preset') {
    if (key.kind === 'left' || key.kind === 'right') {
      const current = state.pending ?? matchingStripPreset(configuration);
      const index = STRIP_PRESETS.findIndex(preset => preset.id === current);
      const step = key.kind === 'left' ? -1 : 1;
      state.pending = STRIP_PRESETS[index === -1 ? (step > 0 ? 0 : STRIP_PRESETS.length - 1) : (index + step + STRIP_PRESETS.length) % STRIP_PRESETS.length]!.id;
      return undefined;
    }
    if (key.kind === 'enter' || (key.kind === 'text' && key.value === ' ')) {
      if (!state.pending) { state.message = '←→ chooses a preset to preview; Enter applies it.'; return undefined; }
      const id = state.pending;
      state.pending = undefined;
      state.undo = structuredClone(configuration);
      state.message = `${STRIP_PRESETS.find(preset => preset.id === id)!.label} applied · U undoes it.`;
      return {kind: 'change', configuration: applyStripPreset(configuration, id)};
    }
    return undefined;
  }
  if (row.kind === 'setting') {
    const next = key.kind === 'left' || key.kind === 'right' ? adjustSettingsRow(row.row, configuration, key.kind === 'left' ? -1 : 1)
      : key.kind === 'enter' || (key.kind === 'text' && key.value === ' ') ? toggleSettingsRow(row.row, configuration) : undefined;
    return next ? {kind: 'change', configuration: next} : undefined;
  }
  const next = structuredClone(configuration);
  const module = next.modules.find(item => item.id === row.module.id)!;
  if (key.kind === 'left' || key.kind === 'right') {
    const index = STRIP_ZONES.indexOf(module.stripZone ?? 'right');
    module.stripZone = STRIP_ZONES[(index + (key.kind === 'left' ? -1 : 1) + STRIP_ZONES.length) % STRIP_ZONES.length];
    return {kind: 'change', configuration: next};
  }
  if (key.kind === 'selectUp' || key.kind === 'selectDown') {
    const listed = stripModules(next);
    const at = listed.findIndex(item => item.id === module.id);
    const target = listed[at + (key.kind === 'selectUp' ? -1 : 1)];
    if (!target) { state.message = 'Already at that end of the strip order.'; return undefined; }
    const a = next.modules.indexOf(module), b = next.modules.indexOf(target);
    [next.modules[a], next.modules[b]] = [next.modules[b]!, next.modules[a]!];
    state.selected += key.kind === 'selectUp' ? -1 : 1;
    return {kind: 'change', configuration: next};
  }
  if (key.kind === 'text' && /^[xX]$/u.test(key.value)) {
    // Off the strip, back to where the module would otherwise go; /modules can route it again.
    delete module.surface;
    delete module.stripZone;
    state.message = `${moduleDefinition(module.id)?.label ?? module.id} left the strip.`;
    return {kind: 'change', configuration: next};
  }
  return undefined;
}

const ZONE_LABEL: Record<StripZone, string> = {left: 'Left', center: 'Center', right: 'Right'};

export function stripStudioControls(state: StripStudioState, configuration: PromptConfiguration): Array<[string, string]> {
  const row = rows(configuration)[state.selected];
  const tail: Array<[string, string]> = [...(state.undo ? [['U', 'undo preset'] as [string, string]] : []), ['Esc', state.pending ? 'cancel preview' : 'close']];
  if (row?.kind === 'preset') return [['↑↓', 'select'], ['←→', 'preview preset'], ...(state.pending ? [['Enter', 'apply'] as [string, string]] : []), ...tail];
  if (row?.kind === 'module') return [['↑↓', 'select'], ['←→', 'group'], ['Shift+↑↓', 'order'], ['X', 'off the strip'], ...tail];
  return [['↑↓', 'select'], ['←→', 'change'], ...(row?.row.control === 'boolean' ? [['Space', 'toggle'] as [string, string]] : []), ...tail];
}

/**
 * The Studio panel. `preview(configuration, columns)` is the frontend's own
 * strip renderer over resolved facts, so the preview is exactly the real row.
 */
export function renderStripStudio(state: StripStudioState, configuration: PromptConfiguration, columns: number, height: number,
  preview: (configuration: PromptConfiguration, columns: number) => string): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const visible = rows(configuration);
  const inner = Math.max(10, columns - 4);
  const out = [`  ${primary}Status Strip${reset}  ${subtle}one live row of facts · not saved to history${reset}`, ''];
  const line = (selected: boolean, label: string, value: string, indent = '') =>
    `${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${indent}${focusForeground(selected)}${padCells(label, 22 - indent.length)}${reset}${selected ? `${accent}‹ ${value} ›${reset}` : value}`;
  let modulesHeader = false;
  visible.forEach((row, index) => {
    const selected = index === state.selected;
    if (row.kind === 'preset') {
      const current = matchingStripPreset(configuration);
      const shown = state.pending ? `${STRIP_PRESETS.find(preset => preset.id === state.pending)!.label} (preview)` : current === 'custom' ? 'Custom' : STRIP_PRESETS.find(preset => preset.id === current)!.label;
      out.push(line(selected, 'Preset', shown));
    } else if (row.kind === 'setting') {
      const value = settingsRowValue(row.row, configuration) ?? '';
      out.push(line(selected, row.row.label.trim(), value === 'true' ? 'On' : value === 'false' ? 'Off' : value, row.row.parent ? '  ' : ''));
    } else {
      if (!modulesHeader) { out.push('', `  ${subtle}Modules on the strip${reset}`); modulesHeader = true; }
      const label = safeContextText(moduleDefinition(row.module.id)?.label ?? row.module.id, 40);
      out.push(line(selected, label, ZONE_LABEL[row.module.stripZone ?? 'right'], '  '));
    }
  });
  if (configuration.statusStrip.enabled && !modulesHeader) out.push('', `  ${subtle}No modules on the strip · /modules → S routes one here${reset}`);
  if (configuration.statusStrip.enabled && configuration.provider !== 'nmsh') {
    const main = surfaceAvailability('mainPrompt', configuration);
    if (!main.available) out.push(`  ${subtle}${main.reason}; the strip works with it unchanged.${reset}`);
  }
  const selectedRow = visible[state.selected];
  if (state.pending) {
    out.push('', `  ${subtle}${STRIP_PRESETS.find(preset => preset.id === state.pending)!.label} would change${reset}`,
      ...stripPresetChanges(configuration, state.pending).map(change => `  ${secondary}· ${change}${reset}`));
  } else if (selectedRow?.kind === 'setting' && selectedRow.row.description) out.push('', `  ${subtle}${selectedRow.row.description}${reset}`);
  if (state.message) out.push(`  ${secondary}${state.message}${reset}`);
  const shown = state.pending ? applyStripPreset(configuration, state.pending) : configuration;
  if (shown.statusStrip.enabled) {
    const at = (width: number) => preview(shown, width);
    out.push('', `  ${subtle}Preview${state.pending ? ' (not applied)' : ''} · ${inner} columns${reset}`, at(inner) || `  ${subtle}(nothing to show yet)${reset}`);
    if (inner > 60) out.push(`  ${subtle}At 50 columns${reset}`, at(50) || `  ${subtle}(nothing fits)${reset}`);
  } else out.push('', `  ${subtle}Status Strip is Off · Space on the first row turns it on${reset}`);
  out.push('', ...renderControlRows(stripStudioControls(state, configuration), inner));
  return framePanel(out.map(text => truncateAnsi(text, columns)), columns).slice(0, Math.max(1, height));
}
