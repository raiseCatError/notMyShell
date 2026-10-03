import type {FamilyRoles, FamilyUi} from './themeFamilies.js';

/**
 * Custom Native NMSh themes. The canonical format is NMSh Theme JSON:
 * declarative semantic roles only, versioned, validated on every load and
 * never executed. Explicit per-module colors in the prompt configuration stay
 * authoritative over any theme. Unknown top-level fields survive a round trip
 * so a future version's additions are not destroyed by an older NMSh.
 */

export const THEME_SCHEMA = 'nmsh-theme';
export const THEME_SCHEMA_VERSION = 1;

/** Prompt semantic roles a custom theme defines (module fills). */
export const PROMPT_THEME_ROLES = ['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker', 'kubernetes', 'success', 'failure'] as const;
export type PromptThemeRole = typeof PROMPT_THEME_ROLES[number];

/** NMSh chrome roles. Warning and Info are kept for completeness and future surfaces. */
export const UI_THEME_ROLES = ['accent', 'primary', 'secondary', 'subtle', 'separator', 'selection', 'success', 'warning', 'failure', 'info'] as const;
export type UiThemeRole = typeof UI_THEME_ROLES[number];

export const ROLE_LABELS: Record<PromptThemeRole | UiThemeRole, string> = {
  project: 'Project', cwd: 'Path', gitBranch: 'Git branch', node: 'Node', go: 'Go', python: 'Python', docker: 'Docker', kubernetes: 'Kubernetes',
  success: 'Success', failure: 'Failure', accent: 'Accent', primary: 'Primary text', secondary: 'Secondary text', subtle: 'Muted text',
  separator: 'Separator', selection: 'Selection', warning: 'Warning', info: 'Info',
};

export interface CustomTheme {
  schema: typeof THEME_SCHEMA;
  version: number;
  name: string;
  /** The theme it was cloned from, for display only. */
  basedOn?: string;
  /** Whether text tiers were designed for a dark terminal; light themes keep NMSh's text tiers. */
  dark: boolean;
  prompt: Record<PromptThemeRole, string>;
  ui: Record<UiThemeRole, string>;
  /** Unknown fields from a newer schema, preserved verbatim on export. */
  extra?: Record<string, unknown>;
}

const HEX = /^#[0-9a-f]{6}$/iu;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** A normalized hex (`#rrggbb`), accepting `rgb`/`rrggbb` with or without `#`; undefined when invalid. */
export function parseHexInput(value: string): string | undefined {
  const text = value.trim().replace(/^#/u, '').toLowerCase();
  if (/^[0-9a-f]{6}$/u.test(text)) return `#${text}`;
  if (/^[0-9a-f]{3}$/u.test(text)) return `#${[...text].map(c => c + c).join('')}`;
  return undefined;
}

const NAME = /^[^\u0000-\u001f\u007f-\u009f]{1,48}$/u;

/** Printable text only (no C0/C1 controls, so no escape sequences), trimmed to 48 characters. */
export function sanitizeName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim().slice(0, 48);
}

export type ThemeValidation = {ok: true; theme: CustomTheme; warnings: string[]} | {ok: false; errors: string[]};

/**
 * Validates untrusted theme data. Missing roles are an error (no silent
 * defaults), invalid colors are named, a newer schema version is accepted
 * with a warning, and unknown fields are preserved under `extra`.
 */
export function validateTheme(value: unknown): ThemeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) return {ok: false, errors: ['Not a JSON object.']};
  if (value.schema !== THEME_SCHEMA) errors.push(`Not an NMSh theme (schema must be "${THEME_SCHEMA}").`);
  const version = typeof value.version === 'number' && Number.isInteger(value.version) ? value.version : NaN;
  if (!Number.isFinite(version) || version < 1) errors.push('Missing or invalid version.');
  else if (version > THEME_SCHEMA_VERSION) warnings.push(`Theme version ${version} is newer than this NMSh (${THEME_SCHEMA_VERSION}); unknown fields are kept.`);
  const name = typeof value.name === 'string' && NAME.test(value.name.trim()) ? value.name.trim() : '';
  if (!name) errors.push('Name must be 1–48 printable characters.');
  const prompt = isRecord(value.prompt) ? value.prompt : {};
  const ui = isRecord(value.ui) ? value.ui : {};
  for (const role of PROMPT_THEME_ROLES) if (!validHex(prompt[role])) errors.push(`prompt.${role} must be a #rrggbb color.`);
  for (const role of UI_THEME_ROLES) if (!validHex(ui[role])) errors.push(`ui.${role} must be a #rrggbb color.`);
  if (errors.length) return {ok: false, errors};
  const known = new Set(['schema', 'version', 'name', 'basedOn', 'dark', 'prompt', 'ui', 'extra']);
  const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key)));
  const basedOn = typeof value.basedOn === 'string' && NAME.test(value.basedOn) ? value.basedOn : undefined;
  return {ok: true, warnings, theme: {
    schema: THEME_SCHEMA, version: Math.min(version, THEME_SCHEMA_VERSION), name, dark: value.dark !== false,
    ...(basedOn ? {basedOn} : {}),
    prompt: Object.fromEntries(PROMPT_THEME_ROLES.map(role => [role, (prompt[role] as string).toLowerCase()])) as CustomTheme['prompt'],
    ui: Object.fromEntries(UI_THEME_ROLES.map(role => [role, (ui[role] as string).toLowerCase()])) as CustomTheme['ui'],
    ...(Object.keys(extra).length ? {extra} : {}),
  }};
}

/** Configuration copies of a theme survive only if valid. */
export function normalizeCustomTheme(value: unknown): CustomTheme | undefined {
  const result = validateTheme(value);
  return result.ok ? result.theme : undefined;
}

/** NMSh Theme JSON, pretty and stable; unknown fields from import are written back. */
export function exportTheme(theme: CustomTheme): string {
  const {extra, ...known} = theme;
  return `${JSON.stringify({...extra, ...known, version: THEME_SCHEMA_VERSION}, null, 2)}\n`;
}

/** A starting point cloned from any theme's resolved colors. */
export function cloneTheme(name: string, basedOn: string, prompt: Record<PromptThemeRole, string>, ui: Partial<FamilyUi> & Record<'accent' | 'separator' | 'success' | 'failure', string>,
  defaults: Record<UiThemeRole, string>, dark: boolean): CustomTheme {
  return {schema: THEME_SCHEMA, version: THEME_SCHEMA_VERSION, name, basedOn, dark,
    prompt: {...prompt},
    ui: {...defaults, ...Object.fromEntries(Object.entries(ui).filter(([, value]) => validHex(value))), warning: defaults.warning, info: defaults.info}};
}

export function themeFromFamilyRoles(roles: FamilyRoles): Record<PromptThemeRole, string> {
  return {...roles};
}

// ---- Palette imports ---------------------------------------------------------

export type ImportFormat = 'nmsh' | 'base16' | 'windowsTerminal';
export interface ThemeImport {format: ImportFormat; theme: CustomTheme; warnings: string[]}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const MAPPED_NOTE = 'Imported from an ANSI palette: NMSh semantic roles were mapped from its colors. Review them in the preview; the mapping is not lossless.';

/**
 * Base16 (YAML `baseXX: "hex"` lines or JSON) mapped explicitly onto NMSh
 * roles. Only the scheme name and base00–base0F are read; nothing else is
 * interpreted.
 */
export function importBase16(text: string, defaults: Record<UiThemeRole, string>): ThemeImport | undefined {
  const colors: Record<string, string> = {};
  let name = '';
  try {
    const json = JSON.parse(text) as unknown;
    if (isRecord(json)) {
      for (const [key, value] of Object.entries(isRecord(json.palette) ? json.palette : json)) {
        const hex = typeof value === 'string' ? parseHexInput(value) : undefined;
        if (/^base0[0-9a-f]$/iu.test(key) && hex) colors[key.toLowerCase()] = hex;
      }
      if (typeof json.scheme === 'string') name = json.scheme; else if (typeof json.name === 'string') name = json.name;
    }
  } catch {
    for (const line of text.split('\n').slice(0, 200)) {
      const match = /^\s*(base0[0-9a-fA-F])\s*:\s*["']?#?([0-9a-fA-F]{6})["']?\s*(?:#.*)?$/u.exec(line);
      if (match) colors[match[1]!.toLowerCase()] = `#${match[2]!.toLowerCase()}`;
      const scheme = /^\s*(?:scheme|name)\s*:\s*["']?([^"'\n]{1,48})["']?\s*$/u.exec(line);
      if (scheme && !name) name = scheme[1]!.trim();
    }
  }
  const needed = ['base00', 'base01', 'base02', 'base03', 'base05', 'base08', 'base09', 'base0a', 'base0b', 'base0c', 'base0d', 'base0e'];
  if (!needed.every(key => colors[key])) return undefined;
  const c = colors as Record<string, string>;
  const dark = luminance(c.base00!) < 0.5;
  // Names come from untrusted files: only printable text reaches the screen.
  const safeName = sanitizeName(name) || 'Imported Base16';
  const theme: CustomTheme = {schema: THEME_SCHEMA, version: THEME_SCHEMA_VERSION, name: safeName, basedOn: 'Base16 import', dark,
    prompt: {project: c.base0e!, cwd: c.base02!, gitBranch: c.base0d!, node: c.base0b!, go: c.base0c!, python: c.base0a!, docker: c.base0d!,
      kubernetes: c.base09!, success: c.base0b!, failure: c.base08!},
    ui: {...defaults, accent: c.base0e!, separator: c.base03!, success: c.base0b!, warning: c.base0a!, failure: c.base08!, info: c.base0c!,
      ...(dark ? {primary: c.base05!, secondary: c.base04 ?? c.base05!, subtle: c.base03!, selection: c.base02!} : {})}};
  return {format: 'base16', theme, warnings: [MAPPED_NOTE]};
}

/** Windows Terminal color scheme JSON (`name`, `background`, `foreground`, ANSI names). */
export function importWindowsTerminal(text: string, defaults: Record<UiThemeRole, string>): ThemeImport | undefined {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return undefined; }
  if (!isRecord(json)) return undefined;
  const pick = (key: string) => typeof json[key] === 'string' ? parseHexInput(json[key] as string) : undefined;
  const keys = ['background', 'foreground', 'black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'brightBlack', 'brightPurple'];
  const c = Object.fromEntries(keys.map(key => [key, pick(key)]));
  if (!keys.every(key => c[key])) return undefined;
  const dark = luminance(c.background!) < 0.5;
  const selection = pick('selectionBackground') ?? c.brightBlack!;
  const name = typeof json.name === 'string' ? sanitizeName(json.name) || 'Imported scheme' : 'Imported scheme';
  const theme: CustomTheme = {schema: THEME_SCHEMA, version: THEME_SCHEMA_VERSION, name, basedOn: 'Windows Terminal scheme', dark,
    prompt: {project: c.purple!, cwd: c.brightBlack!, gitBranch: c.blue!, node: c.green!, go: c.cyan!, python: c.yellow!, docker: c.blue!,
      kubernetes: c.brightPurple!, success: c.green!, failure: c.red!},
    ui: {...defaults, accent: c.purple!, separator: c.brightBlack!, success: c.green!, warning: c.yellow!, failure: c.red!, info: c.cyan!,
      ...(dark ? {primary: c.foreground!, secondary: c.foreground!, subtle: c.brightBlack!, selection} : {})}};
  return {format: 'windowsTerminal', theme, warnings: [MAPPED_NOTE]};
}

/** Tries NMSh Theme JSON first, then the supported palette formats. Never evaluates anything. */
export function importTheme(text: string, defaults: Record<UiThemeRole, string>): ThemeImport | {errors: string[]} {
  if (text.length > 256 * 1024) return {errors: ['File is larger than 256 KiB.']};
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  if (isRecord(json) && json.schema === THEME_SCHEMA) {
    const result = validateTheme(json);
    return result.ok ? {format: 'nmsh', theme: result.theme, warnings: result.warnings} : {errors: result.errors};
  }
  const imported = importWindowsTerminal(text, defaults) ?? importBase16(text, defaults);
  return imported ?? {errors: ['Not an NMSh theme, Base16 scheme or Windows Terminal color scheme.']};
}

/** A filesystem-safe slug for an exported theme file name. */
export function themeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40) || 'theme';
}
