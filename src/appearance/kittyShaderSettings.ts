/** Persisted NMSh Kitty shader choices (shape only; validity against the installed catalog is checked when planning). */
import type {ShaderValue} from './kittyShaderCatalog.js';

export interface KittyShaderEffect {id: string; enabled: boolean; values: Record<string, ShaderValue>}
export interface KittyShaderSettings {
  /** Order is pipeline order. Disabled entries keep their tuned values. */
  effects: KittyShaderEffect[];
  /** NMSh's pipeline runs after (default) or before the person's own shaders. */
  placement: 'after' | 'before';
}
/** Ghostty runs NMSh's passes in this order, after the shaders listed in the person's own config files. */
export interface GhosttyShaderSettings {effects: KittyShaderEffect[]}
export interface HostShaderSettings {kitty: KittyShaderSettings; ghostty: GhosttyShaderSettings}
export const DEFAULT_HOST_SHADERS: HostShaderSettings = {kitty: {effects: [], placement: 'after'}, ghostty: {effects: []}};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Bounded shape normalization only; whether a value is valid for the installed Kitty is decided by validateEffects. */
export function normalizeHostShaders(value: unknown): HostShaderSettings {
  const kitty = isRecord(value) && isRecord(value.kitty) ? value.kitty : {};
  const ghostty = isRecord(value) && isRecord(value.ghostty) ? value.ghostty : {};
  return {kitty: {effects: normalizeEffects(kitty.effects), placement: kitty.placement === 'before' ? 'before' : 'after'}, ghostty: {effects: normalizeEffects(ghostty.effects)}};
}

function normalizeEffects(list: unknown): KittyShaderEffect[] {
  const seen = new Set<string>();
  const effects: KittyShaderEffect[] = [];
  for (const item of Array.isArray(list) ? list.slice(0, 32) : []) {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^[a-z0-9-]{1,48}$/u.test(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const values: Record<string, ShaderValue> = {};
    for (const [name, raw] of Object.entries(isRecord(item.values) ? item.values : {}).slice(0, 32)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(name)) continue;
      if (typeof raw === 'boolean' || (typeof raw === 'number' && Number.isFinite(raw))) values[name] = raw;
      else if (Array.isArray(raw) && raw.length >= 2 && raw.length <= 4 && raw.every(part => typeof part === 'number' && Number.isFinite(part))) values[name] = [...raw] as number[];
    }
    effects.push({id: item.id, enabled: item.enabled === true, values});
  }
  return effects;
}
