/**
 * Theme Bridge persisted model.
 *
 * Two levels: a safety switch (`enabled`, Off by default) and, when On, an
 * apply policy:
 *
 *   manual  each target uses its own stored mode (Independent / Follow / Choose)
 *   follow  every supported target follows the active NMSh theme
 *   choose  every supported target uses one global pinned theme
 *
 * The per-target settings are the Manual state; global policies never rewrite
 * them, so returning to Manual restores exactly what was there. Effective
 * behavior is always computed (switch × policy × capability × stored state).
 *
 * This module is data only (no theme resolution), so the configuration
 * normalizer can use it without import cycles.
 */

export const BRIDGE_TARGETS = ['fzf', 'pager', 'lsColors', 'bat', 'delta', 'tmux', 'neovim', 'vim', 'helix'] as const;
export type BridgeTargetId = typeof BRIDGE_TARGETS[number];
export const BRIDGE_TARGET_LABELS: Record<BridgeTargetId, string> = {
  fzf: 'fzf', pager: 'less / man', lsColors: 'File listing colors', bat: 'bat', delta: 'delta', tmux: 'tmux', neovim: 'Neovim', vim: 'Vim', helix: 'Helix',
};

/**
 * What NMSh can do for a target. `direct`: invocation or session environment
 * only. `managed`: NMSh generates an owned artifact (and may need a reviewed
 * activation step). `detected`: shown for status only; never managed.
 */
export type BridgeCapability = 'direct' | 'managed' | 'detected';
export const BRIDGE_CAPABILITY: Record<BridgeTargetId, BridgeCapability> = {
  fzf: 'direct', pager: 'direct', lsColors: 'direct', bat: 'managed', delta: 'detected', tmux: 'managed', neovim: 'managed', vim: 'managed', helix: 'managed',
};
export const BRIDGE_CAPABILITY_LABELS: Record<BridgeCapability, string> = {direct: 'Direct and environment', managed: 'Managed themes', detected: 'Detected only'};
export const bridgeSupported = (target: BridgeTargetId): boolean => BRIDGE_CAPABILITY[target] !== 'detected';

export const BRIDGE_MODES = ['independent', 'follow', 'choose'] as const;
export type BridgeMode = typeof BRIDGE_MODES[number];
export const BRIDGE_MODE_LABELS: Record<BridgeMode, string> = {independent: 'Independent', follow: 'Follow NMSh', choose: 'Choose theme'};

export const BRIDGE_POLICIES = ['manual', 'follow', 'choose'] as const;
export type BridgePolicy = typeof BRIDGE_POLICIES[number];
export const BRIDGE_POLICY_LABELS: Record<BridgePolicy, string> = {manual: 'Manual', follow: 'Follow NMSh', choose: 'Choose theme'};

export interface BridgeTargetSetting {
  mode: BridgeMode;
  /** Choose theme only: a stable theme reference (`builtin:…` or `asset:…`). Kept when the mode changes. */
  theme?: string;
}

export interface ThemeBridgeSettings {
  /** Safety switch (Setup's "Extend colors to tools?"), Off by default; Off keeps everything Independent but preserves choices. */
  enabled: boolean;
  policy: BridgePolicy;
  /** The global pinned theme for policy `choose` (kept when the policy changes). */
  theme?: string;
  /** Manual state: one setting per target. */
  targets: Record<BridgeTargetId, BridgeTargetSetting>;
}

export const DEFAULT_THEME_BRIDGE = (): ThemeBridgeSettings =>
  ({enabled: false, policy: 'manual', targets: Object.fromEntries(BRIDGE_TARGETS.map(id => [id, {mode: 'independent'}])) as Record<BridgeTargetId, BridgeTargetSetting>});

/** The setting in effect for a target: switch, policy and capability applied over the stored Manual state. */
export function effectiveSetting(settings: ThemeBridgeSettings, target: BridgeTargetId): BridgeTargetSetting {
  if (!settings.enabled || !bridgeSupported(target)) return {mode: 'independent'};
  if (settings.policy === 'follow') return {mode: 'follow'};
  if (settings.policy === 'choose') return settings.theme ? {mode: 'choose', theme: settings.theme} : {mode: 'independent'};
  return settings.targets[target];
}

export function effectiveMode(settings: ThemeBridgeSettings, target: BridgeTargetId): BridgeMode {
  return effectiveSetting(settings, target).mode;
}

/** Whether a target's own mode/theme can be edited now (Manual policy, supported target). */
export function targetEditable(settings: ThemeBridgeSettings, target: BridgeTargetId): boolean {
  return settings.policy === 'manual' && bridgeSupported(target);
}

const REF = /^(?:asset:[a-z0-9][a-z0-9-]{2,39}|builtin:[A-Za-z0-9]+(?:@[a-z]+)?)$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Unknown or malformed targets read as Independent; a Choose without a valid
 * reference has nothing to pin and reads as Independent. Configurations from
 * before the policy existed read as Manual, so no per-target choice is lost.
 */
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
  settings.enabled = isRecord(value) && typeof value.enabled === 'boolean' ? value.enabled : BRIDGE_TARGETS.some(id => settings.targets[id].mode !== 'independent');
  const theme = isRecord(value) && typeof value.theme === 'string' && REF.test(value.theme) ? value.theme : undefined;
  if (theme) settings.theme = theme;
  const policy = isRecord(value) && BRIDGE_POLICIES.includes(value.policy as BridgePolicy) ? value.policy as BridgePolicy : 'manual';
  settings.policy = policy === 'choose' && !theme ? 'manual' : policy;
  return settings;
}

/** Targets pinned to a reference in the Manual state (Choose theme), for delete protection. */
export function targetsPinnedTo(settings: ThemeBridgeSettings, ref: string): BridgeTargetId[] {
  // Pins count even while the switch is Off or a global policy applies: they come back with Manual.
  return BRIDGE_TARGETS.filter(id => settings.targets[id].mode === 'choose' && settings.targets[id].theme === ref);
}

/** The global Choose theme pins a reference (whatever the current policy, since it returns with Choose). */
export function globallyPinnedTo(settings: ThemeBridgeSettings, ref: string): boolean {
  return settings.theme === ref;
}

export function anyBridgeTargetActive(settings: ThemeBridgeSettings): boolean {
  return BRIDGE_TARGETS.some(id => effectiveMode(settings, id) !== 'independent');
}
