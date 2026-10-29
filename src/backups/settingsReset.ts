/**
 * Scoped reset of NMSh's own settings file. Each scope names exactly which top-level keys it returns to their defaults, so a
 * reset of visual and general preferences never also re-runs onboarding or changes the update policy. Everything else in
 * config.json (the user's themes and presets, fields this version does not know) is kept byte-for-value.
 */
import {DEFAULT_PROMPT_CONFIGURATION} from '../prompt/configuration.js';

export type SettingsScope = 'preferences' | 'onboarding' | 'updates';
export const SETTINGS_SCOPES: readonly SettingsScope[] = ['preferences', 'onboarding', 'updates'];
export const SCOPE_LABELS: Record<SettingsScope, string> = {
  preferences: 'NMSh preferences → defaults (keeps first-run state, update policy and your themes)',
  onboarding: 'First-run state → show setup again (onboarding, glyph choice, tools setup)',
  updates: 'Update policy → default (Automatic, daily)',
};
const ONBOARDING = ['onboardingComplete', 'introSeen', 'toolsSetupComplete', 'glyphStyle', 'glyphChoiceComplete'];
const UPDATES = ['updateMode', 'updateFrequency'];
/** The user's own content in config.json: never part of a settings reset. */
const USER_CONTENT = ['themes', 'customTheme', 'welcomePresets', 'agentProfiles'];
/** Known optional preference keys with no default value: a preferences reset removes them. */
const OPTIONAL_PREFERENCES = ['startingPoint', 'promptSymbolCustom'];
const DEFAULTS = DEFAULT_PROMPT_CONFIGURATION as unknown as Record<string, unknown>;
const KNOWN = new Set([...Object.keys(DEFAULTS), ...OPTIONAL_PREFERENCES, ...USER_CONTENT]);

export function scopeKeys(scope: SettingsScope): string[] {
  if (scope === 'onboarding') return ONBOARDING;
  if (scope === 'updates') return UPDATES;
  return [...Object.keys(DEFAULTS), ...OPTIONAL_PREFERENCES].filter(key => !ONBOARDING.includes(key) && !UPDATES.includes(key) && !USER_CONTENT.includes(key));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const show = (value: unknown) => value === undefined ? '(not set)' : JSON.stringify(value);
const clip = (text: string) => text.length > 96 ? `${text.slice(0, 95)}…` : text;

/** Leaf-level differences, at most three levels deep, as `path: before → after`. */
function differences(path: string, before: unknown, after: unknown, depth = 0): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (depth < 2 && isRecord(before) && isRecord(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => differences(`${path}.${key}`, before[key], after[key], depth + 1));
  }
  return [`${path}: ${clip(show(before))} → ${clip(show(after))}`];
}

export interface SettingsResetPlan {after: string | undefined; summary: string[]; changed: number}

/** Pure: plans the selected scopes against the current file text. Malformed settings are never guessed at. */
export function planSettingsReset(text: string | undefined, scopes: ReadonlySet<SettingsScope>): SettingsResetPlan {
  if (text === undefined) return {after: undefined, summary: ['There is no config.json yet: NMSh already uses its defaults.'], changed: 0};
  let current: Record<string, unknown> = {};
  {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error('config.json is not valid JSON; NMSh will not guess at a reset. Fix or move it first.'); }
    if (!isRecord(parsed)) throw new Error('config.json is not a settings object; NMSh will not guess at a reset. Fix or move it first.');
    current = parsed;
  }
  const next: Record<string, unknown> = structuredClone(current);
  const keys = [...scopes].flatMap(scopeKeys);
  for (const key of keys) {
    if (key in DEFAULTS) next[key] = structuredClone(DEFAULTS[key]);
    else delete next[key];
  }
  const changes = keys.flatMap(key => differences(key, current[key], next[key]));
  const kept = (scope: SettingsScope) => !scopes.has(scope);
  const keptValues = (list: string[]) => list.filter(key => key in current).map(key => `${key} ${show(current[key])}`).join(', ') || 'defaults';
  const unknown = Object.keys(current).filter(key => !KNOWN.has(key));
  const themes = Array.isArray(current.themes) ? current.themes.length : 0;
  const presets = Array.isArray(current.welcomePresets) ? current.welcomePresets.length : 0;
  const summary = [
    changes.length ? `Settings that change (${changes.length}):` : 'Settings already match their defaults for this scope.',
    ...changes.map(line => `  ${line}`),
    ...(kept('onboarding') ? [`Kept: first-run state (${keptValues(ONBOARDING)}).`] : []),
    ...(kept('updates') ? [`Kept: update policy (${keptValues(UPDATES)}).`] : []),
    `Kept: your themes (${themes}) and welcome presets (${presets}).`,
    ...(unknown.length ? [`Kept: ${unknown.length} field${unknown.length === 1 ? '' : 's'} this version does not know (${unknown.slice(0, 6).join(', ')}${unknown.length > 6 ? ', …' : ''}).`] : []),
  ];
  const after = `${JSON.stringify(next, null, 2)}\n`;
  return {after: changes.length ? after : text, summary, changed: changes.length};
}
