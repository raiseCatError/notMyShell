import {stripTerminalControls} from '../util/terminalControls.js';

export const LOGOS = ['none', 'mascot', 'image', 'art'] as const;
export const FITS = ['contain', 'cover', 'crop'] as const;
export const ALPHAS = ['preserve', 'theme', 'black', 'white'] as const;
export const LAYOUTS = ['left', 'right', 'top'] as const;
export const PALETTES = ['theme', 'chroma', 'custom'] as const;
export const EFFECTS = ['original', 'float', 'pulse', 'parallax', 'glow', 'shimmer', 'particles', 'reveal', 'panZoom'] as const;
export const FACTS = ['os', 'shell', 'terminal', 'time', 'uptime', 'version', 'hostname', 'user', 'path', 'git'] as const;
export type WelcomeFact = typeof FACTS[number];
export interface WelcomeStudio {
  /** Old saved cards keep their original presentation until edited. */
  customized: boolean;
  logo: typeof LOGOS[number]; assetPath: string;
  fit: typeof FITS[number]; alpha: typeof ALPHAS[number];
  layout: typeof LAYOUTS[number]; density: 'compact' | 'expanded';
  title: string; greeting: string; links: string[]; border: boolean;
  palette: typeof PALETTES[number]; customColor: string;
  modules: WelcomeFact[]; effect: typeof EFFECTS[number];
}
export const DEFAULT_WELCOME_STUDIO: WelcomeStudio = {
  customized: true, logo: 'mascot', assetPath: '', fit: 'contain', alpha: 'preserve',
  layout: 'left', density: 'compact', title: 'notMyShell', greeting: 'A real shell. A livelier terminal.',
  links: [], border: true, palette: 'theme', customColor: '#A67CF3', modules: ['os', 'shell', 'version'], effect: 'original',
};
export function welcomeText(value: unknown, max = 160): string {
  return typeof value === 'string' ? stripTerminalControls(value, max * 8).replace(/[\r\n\t]/gu, ' ').slice(0, max) : '';
}
function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T { return values.includes(value as T) ? value as T : fallback; }
export function normalizeWelcomeStudio(value: unknown): WelcomeStudio {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const d = DEFAULT_WELCOME_STUDIO;
  return {
    customized: value !== undefined && v.customized !== false, logo: choice(v.logo, LOGOS, d.logo), assetPath: welcomeText(v.assetPath, 4096),
    fit: choice(v.fit, FITS, d.fit), alpha: choice(v.alpha, ALPHAS, d.alpha), layout: choice(v.layout, LAYOUTS, d.layout),
    density: choice(v.density, ['compact', 'expanded'], d.density), title: typeof v.title === 'string' ? welcomeText(v.title) : d.title,
    greeting: typeof v.greeting === 'string' ? welcomeText(v.greeting, 320) : d.greeting,
    links: Array.isArray(v.links) ? v.links.slice(0, 4).filter((x): x is string => typeof x === 'string' && /^https?:\/\/[^\s\x00-\x20]+$/u.test(x) && x.length <= 240 && welcomeText(x, 240) === x) : [],
    border: v.border !== false, palette: choice(v.palette, PALETTES, d.palette),
    customColor: typeof v.customColor === 'string' && /^#[a-f0-9]{6}$/iu.test(v.customColor) ? v.customColor : d.customColor,
    modules: Array.isArray(v.modules) ? [...new Set(v.modules.filter((x): x is WelcomeFact => FACTS.includes(x as WelcomeFact)))].slice(0, FACTS.length) : [...d.modules],
    effect: choice(v.effect, EFFECTS, d.effect),
  };
}
export const WELCOME_PRESETS: ReadonlyArray<{name: string; model: WelcomeStudio}> = [
  {name: 'Vespyr', model: {...DEFAULT_WELCOME_STUDIO, customized: true}},
  {name: 'Quiet', model: {...DEFAULT_WELCOME_STUDIO, customized: true, logo: 'none', border: false, greeting: '', modules: ['shell', 'version']}},
  {name: 'Greeting', model: {...DEFAULT_WELCOME_STUDIO, customized: true, layout: 'top', density: 'expanded', effect: 'float'}},
];
export function exportWelcomePreset(model: WelcomeStudio, includePath = false): string {
  const safe = normalizeWelcomeStudio(model);
  if (!includePath) safe.assetPath = '';
  return JSON.stringify({version: 1, model: safe}, null, 2);
}
export function importWelcomePreset(json: string): WelcomeStudio {
  if (Buffer.byteLength(json) > 32 * 1024) throw new Error('Preset exceeds 32 KiB.');
  const data = JSON.parse(json) as Record<string, unknown>;
  if (!data || typeof data !== 'object' || Object.keys(data).some(k => !['version', 'model'].includes(k)) || data.version !== 1 || !data.model || typeof data.model !== 'object' || Array.isArray(data.model)) throw new Error('Expected a version 1 Welcome preset.');
  const model = data.model as Record<string, unknown>;
  const normalized = normalizeWelcomeStudio(model);
  for (const [key, value] of Object.entries(model)) {
    if (!Object.hasOwn(DEFAULT_WELCOME_STUDIO, key) || JSON.stringify(value) !== JSON.stringify(normalized[key as keyof WelcomeStudio])) throw new Error(`Invalid Welcome field: ${welcomeText(key)}.`);
  }
  return normalized;
}
export interface SavedWelcomePreset {name: string; model: WelcomeStudio}
export function normalizeWelcomePresets(value: unknown): SavedWelcomePreset[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string') return [];
    try { return [{name: welcomeText(item.name, 48), model: importWelcomePreset(JSON.stringify({version: 1, model: item.model}))}]; } catch { return []; }
  });
}
