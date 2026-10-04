/**
 * Theme Bridge persisted model: one independent mode per target. Every target
 * starts Independent, which means NMSh injects and changes nothing for it.
 * Follow NMSh tracks the active Native theme; Choose theme pins a stable theme
 * reference (built-in, Imported or Custom) that the main theme never changes.
 *
 * This module is data only (no theme resolution), so the configuration
 * normalizer can use it without import cycles.
 */

export const BRIDGE_TARGETS = ['fzf', 'pager', 'lsColors', 'bat', 'delta', 'tmux', 'neovim', 'vim', 'helix'] as const;
export type BridgeTargetId = typeof BRIDGE_TARGETS[number];
export const BRIDGE_TARGET_LABELS: Record<BridgeTargetId, string> = {
  fzf: 'fzf', pager: 'less / man', lsColors: 'LS_COLORS', bat: 'bat', delta: 'delta', tmux: 'tmux', neovim: 'Neovim', vim: 'Vim', helix: 'Helix',
};

export const BRIDGE_MODES = ['independent', 'follow', 'choose'] as const;
export type BridgeMode = typeof BRIDGE_MODES[number];
export const BRIDGE_MODE_LABELS: Record<BridgeMode, string> = {independent: 'Independent', follow: 'Follow NMSh', choose: 'Choose theme'};

export interface BridgeTargetSetting {
  mode: BridgeMode;
  /** Choose theme only: a stable theme reference (`builtin:…` or `asset:…`). Kept when the mode changes. */
  theme?: string;
}

export interface ThemeBridgeSettings {
  /**
   * Master switch (Setup's "Extend NMSh colors to terminal tools?"), Off by
   * default. Off makes every target effectively Independent while keeping
   * the per-target choices for when it is turned back on.
   */
  enabled: boolean;
  targets: Record<BridgeTargetId, BridgeTargetSetting>;
}

export const DEFAULT_THEME_BRIDGE = (): ThemeBridgeSettings =>
  ({enabled: false, targets: Object.fromEntries(BRIDGE_TARGETS.map(id => [id, {mode: 'independent'}])) as Record<BridgeTargetId, BridgeTargetSetting>});

/** The mode in effect: the target's own mode while Theme Bridge is on, Independent otherwise. */
export function effectiveMode(settings: ThemeBridgeSettings, target: BridgeTargetId): BridgeMode {
  return settings.enabled ? settings.targets[target].mode : 'independent';
}

const REF = /^(?:asset:[a-z0-9][a-z0-9-]{2,39}|builtin:[A-Za-z0-9]+(?:@[a-z]+)?)$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Unknown or malformed targets read as Independent; a Choose without a valid reference has nothing to pin and reads as Independent. */
export function normalizeThemeBridge(value: unknown): ThemeBridgeSettings {
  const settings = DEFAULT_THEME_BRIDGE();
  const targets = isRecord(value) && isRecord(value.targets) ? value.targets : {};
  for (const id of BRIDGE_TARGETS) {
    const item = targets[id];
    if (!isRecord(item)) continue;
    const theme = typeof item.theme === 'string' && REF.test(item.theme) ? item.theme : undefined;
    const mode = BRIDGE_MODES.includes(item.mode as BridgeMode) ? item.mode as BridgeMode : 'independent';
    settings.targets[id] = {mode: mode === 'choose' && !theme ? 'independent' : mode, ...(theme ? {theme} : {})};
  }
  // A configuration that already has active targets but no switch (none shipped without one) reads as On.
  settings.enabled = isRecord(value) && typeof value.enabled === 'boolean' ? value.enabled : BRIDGE_TARGETS.some(id => settings.targets[id].mode !== 'independent');
  return settings;
}

/** Targets pinned to a theme reference (Choose theme), for delete protection. */
export function targetsPinnedTo(settings: ThemeBridgeSettings, ref: string): BridgeTargetId[] {
  // Pins count even while the switch is Off: turning it back on must never find a dangling reference.
  return BRIDGE_TARGETS.filter(id => settings.targets[id].mode === 'choose' && settings.targets[id].theme === ref);
}

export function anyBridgeTargetActive(settings: ThemeBridgeSettings): boolean {
  return BRIDGE_TARGETS.some(id => effectiveMode(settings, id) !== 'independent');
}
