import {parseDocument} from 'yaml';
import {parse as parseToml} from 'smol-toml';
import {XMLParser} from 'fast-xml-parser';
import {mixRgb} from '../chroma/chroma.js';
import {hexColor, parseHexColor} from '../chroma/color.js';
import {
  importBase16, importWindowsTerminal, parseHexInput, sanitizeName, THEME_SCHEMA, THEME_SCHEMA_VERSION, validateTheme,
  PROMPT_THEME_ROLES, ROLE_LABELS, type CustomTheme, type PromptThemeRole, type TerminalPalette, type UiThemeRole,
} from './customTheme.js';
import {THEME_SOURCE_LABELS, type ThemeSourceKind} from './themeLibrary.js';

/**
 * Theme import: bounded local data parsing into one NMSh Native theme.
 *
 * Every format is parsed as data only. Nothing is executed, sourced,
 * evaluated, templated, fetched or followed: no shell, no Lua, no Oh My Posh
 * templates or binary, no includes, no remote schemas or inheritance, no XML
 * entities. Unsupported or dynamic source concepts become preview warnings;
 * no color is invented for them. The result is ordinary NMSh Theme JSON plus
 * a mapping/loss disclosure, previewed before anything is stored.
 */

export const IMPORT_SIZE_LIMIT = 256 * 1024;

export interface RoleMapping {role: string; from: string}

export interface ImportPreview {
  format: ThemeSourceKind;
  theme: CustomTheme;
  /** The source's own scheme name, sanitized. */
  sourceName?: string;
  /** Where each Native role came from, for the preview. */
  mapping: RoleMapping[];
  /** Lossy mapping, ignored settings and unsupported concepts, in plain words. */
  warnings: string[];
}

export type ImportOutcome = ImportPreview | {errors: string[]};
export type ImportFormatChoice = ThemeSourceKind | 'auto';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'bright black', 'bright red', 'bright green',
  'bright yellow', 'bright blue', 'bright magenta', 'bright cyan', 'bright white'];
const LOSSY = 'A terminal palette has fewer concepts than NMSh roles; roles were mapped from ANSI colors and are not a lossless conversion.';

function luminance(hex: string): number {
  const color = parseHexColor(hex)!;
  return (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;
}

const mix = (a: string, b: string, amount: number) => hexColor(mixRgb(parseHexColor(a)!, parseHexColor(b)!, amount));

/** Strict `#rgb` / `#rrggbb` (and the same without `#`); names and functions are not colors here. */
function hex(value: unknown): string | undefined {
  return typeof value === 'string' && /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(value.trim()) ? parseHexInput(value) : undefined;
}

function finish(format: ThemeSourceKind, theme: CustomTheme, mapping: RoleMapping[], warnings: string[], sourceName?: string): ImportOutcome {
  // Every generated role is validated exactly like a hand-written NMSh theme.
  const checked = validateTheme(theme);
  if (!checked.ok) return {errors: checked.errors};
  return {format, theme: checked.theme, mapping, warnings: [...new Set(warnings)], ...(sourceName ? {sourceName} : {})};
}

/**
 * One terminal palette → Native roles. The same documented mapping serves
 * every terminal scheme format, so Kitty, Ghostty, iTerm2, WezTerm and
 * Windows Terminal schemes with the same colors give the same theme.
 */
export function themeFromTerminal(name: string, kind: ThemeSourceKind, terminal: TerminalPalette, defaults: Record<UiThemeRole, string>): {theme: CustomTheme; mapping: RoleMapping[]} {
  const a = terminal.ansi;
  const dark = luminance(terminal.background) < 0.5;
  const prompt: Record<PromptThemeRole, string> = {project: a[5]!, cwd: a[8]!, gitBranch: a[4]!, node: a[2]!, go: a[6]!, python: a[3]!,
    docker: a[12]!, kubernetes: a[13]!, success: a[2]!, failure: a[1]!};
  const source: Record<PromptThemeRole, number> = {project: 5, cwd: 8, gitBranch: 4, node: 2, go: 6, python: 3, docker: 12, kubernetes: 13, success: 2, failure: 1};
  const selection = terminal.selectionBackground ?? a[8]!;
  const ui: Record<UiThemeRole, string> = {...defaults, accent: a[5]!, separator: a[8]!, success: a[2]!, warning: a[3]!, failure: a[1]!, info: a[6]!,
    // Light schemes keep NMSh's own text tiers in NMSh UI; the terminal palette below still carries the real foreground.
    ...(dark ? {primary: terminal.foreground, secondary: mix(terminal.foreground, terminal.background, 0.25), subtle: a[8]!, selection} : {})};
  const mapping: RoleMapping[] = [
    ...PROMPT_THEME_ROLES.map(role => ({role: ROLE_LABELS[role], from: `${ANSI_NAMES[source[role]]} (color${source[role]})`})),
    {role: 'Accent', from: 'magenta (color5)'}, {role: 'Separator / muted', from: 'bright black (color8)'},
    {role: 'Warning / Info', from: 'yellow (color3) / cyan (color6)'},
    {role: 'Text', from: dark ? 'foreground; secondary is foreground mixed toward background' : 'NMSh text tiers (light scheme)'},
    {role: 'Selection', from: terminal.selectionBackground ? 'selection background' : 'bright black (color8)'},
  ];
  return {mapping, theme: {schema: THEME_SCHEMA, version: THEME_SCHEMA_VERSION, name: sanitizeName(name) || 'Imported theme',
    basedOn: `${THEME_SOURCE_LABELS[kind]} import`, dark, prompt, ui, terminal}};
}

function terminalResult(kind: ThemeSourceKind, name: string, terminal: TerminalPalette, defaults: Record<UiThemeRole, string>, warnings: string[]): ImportOutcome {
  const {theme, mapping} = themeFromTerminal(name, kind, terminal, defaults);
  return finish(kind, theme, mapping, [LOSSY, ...warnings, theme.dark ? 'Interpreted as a dark scheme (dark background).' : 'Interpreted as a light scheme (light background).'], theme.name);
}

function missingAnsi(ansi: Array<string | undefined>): string[] {
  return ansi.flatMap((value, index) => value ? [] : [`color${index}`]);
}

// ---- Kitty -----------------------------------------------------------------

const KITTY_COLORS: Record<string, keyof TerminalPalette> = {foreground: 'foreground', background: 'background', selection_background: 'selectionBackground',
  selection_foreground: 'selectionForeground', cursor: 'cursor'};

/**
 * Kitty theme/config lines: only the documented color assignments are read
 * (`foreground`, `background`, `selection_*`, `cursor`, `color0`–`color15`).
 * `include`/`globinclude`/`envinclude` are never followed and every other
 * directive is ignored and reported.
 */
export function importKitty(text: string, fileName: string, defaults: Record<UiThemeRole, string>): ImportOutcome {
  const ansi: Array<string | undefined> = Array(16).fill(undefined);
  const facts: Partial<TerminalPalette> = {};
  const ignored = new Set<string>();
  let includes = 0;
  let name = '';
  for (const raw of text.split(/\r?\n/u).slice(0, 4000)) {
    const line = raw.trim();
    const meta = /^##\s*name\s*:\s*(.+)$/iu.exec(line);
    if (meta && !name) name = meta[1]!;
    if (!line || line.startsWith('#')) continue;
    const [key = '', value = ''] = line.split(/\s+/u, 2);
    if (/^(?:include|globinclude|envinclude|geninclude)$/u.test(key)) { includes++; continue; }
    const color = /^color(\d{1,3})$/u.exec(key);
    if (color) {
      const index = Number(color[1]);
      if (index < 16) { const parsed = hex(value); if (parsed) ansi[index] = parsed; else ignored.add(`${key} (not a hex color)`); }
      else ignored.add('color16–color255');
      continue;
    }
    const field = KITTY_COLORS[key];
    if (field) { const parsed = hex(value); if (parsed) (facts as Record<string, string>)[field] = parsed; else ignored.add(`${key} (not a hex color)`); continue; }
    ignored.add(key);
  }
  const missing = [...missingAnsi(ansi), ...(!facts.background ? ['background'] : []), ...(!facts.foreground ? ['foreground'] : [])];
  if (missing.length) return {errors: [`Not a complete Kitty color theme: missing ${missing.join(', ')}.`]};
  const warnings = [
    ...(includes ? [`${includes} include directive${includes === 1 ? ' was' : 's were'} not followed; only this file was read.`] : []),
    ...(ignored.size ? [`Non-color Kitty settings were not imported: ${[...ignored].slice(0, 8).join(', ')}${ignored.size > 8 ? '…' : ''}.`] : []),
  ];
  return terminalResult('kitty', name || fileStem(fileName), {...facts, ansi: ansi as string[]} as TerminalPalette, defaults, warnings);
}

// ---- Ghostty ---------------------------------------------------------------

const GHOSTTY_ALLOWED: Record<string, keyof TerminalPalette> = {background: 'background', foreground: 'foreground', 'selection-background': 'selectionBackground',
  'selection-foreground': 'selectionForeground', 'cursor-color': 'cursor'};

/**
 * Ghostty theme files are ordinary Ghostty configuration, so a strict
 * allowlist applies: `palette = N=#hex`, background/foreground,
 * selection colors and cursor color. `config-file` is never followed; every
 * other key is ignored and named in the preview.
 */
export function importGhostty(text: string, fileName: string, defaults: Record<UiThemeRole, string>): ImportOutcome {
  const ansi: Array<string | undefined> = Array(16).fill(undefined);
  const facts: Partial<TerminalPalette> = {};
  const ignored = new Set<string>();
  let includes = 0;
  for (const raw of text.split(/\r?\n/u).slice(0, 4000)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-z0-9-]+)\s*=\s*(.*)$/u.exec(line);
    if (!match) { ignored.add('unrecognized lines'); continue; }
    const key = match[1]!;
    const value = match[2]!.trim().replace(/^"(.*)"$/u, '$1');
    if (key === 'config-file') { includes++; continue; }
    if (key === 'palette') {
      const entry = /^(\d{1,3})\s*=\s*(#?[0-9a-fA-F]{3,6})$/u.exec(value);
      const index = entry ? Number(entry[1]) : NaN;
      const parsed = entry ? hex(entry[2]) : undefined;
      if (index < 16 && parsed) ansi[index] = parsed;
      else if (index >= 16) ignored.add('palette 16–255');
      else ignored.add('palette (not a hex color)');
      continue;
    }
    const field = GHOSTTY_ALLOWED[key];
    if (field) { const parsed = hex(value); if (parsed) (facts as Record<string, string>)[field] = parsed; else ignored.add(`${key} (not a hex color)`); continue; }
    ignored.add(key);
  }
  const missing = [...missingAnsi(ansi), ...(!facts.background ? ['background'] : []), ...(!facts.foreground ? ['foreground'] : [])];
  if (missing.length) return {errors: [`Not a complete Ghostty theme: missing ${missing.join(', ')}.`]};
  const warnings = [
    ...(includes ? ['config-file includes were not followed; only this file was read.'] : []),
    ...(ignored.size ? [`Ghostty non-color options were ignored: ${[...ignored].slice(0, 8).join(', ')}${ignored.size > 8 ? '…' : ''}.`] : []),
  ];
  return terminalResult('ghostty', fileStem(fileName), {...facts, ansi: ansi as string[]} as TerminalPalette, defaults, warnings);
}

// ---- iTerm2 ----------------------------------------------------------------

type OrderedNode = Record<string, OrderedNode[] | string>;

/** The ordered key/value pairs of a plist `<dict>` (fast-xml-parser preserveOrder output). */
function plistDict(children: OrderedNode[]): Array<[string, OrderedNode]> {
  const pairs: Array<[string, OrderedNode]> = [];
  let key: string | undefined;
  for (const child of children.slice(0, 2000)) {
    const tag = Object.keys(child).find(name => name !== ':@');
    if (!tag) continue;
    if (tag === 'key') key = textOf(child.key as OrderedNode[]);
    else if (key !== undefined) { pairs.push([key, child]); key = undefined; }
  }
  return pairs;
}

function textOf(nodes: OrderedNode[] | string | undefined): string {
  if (!Array.isArray(nodes)) return '';
  return nodes.map(node => typeof node['#text'] === 'string' ? node['#text'] : '').join('').trim();
}

/**
 * `.itermcolors` property lists. The XML is bounded, a DOCTYPE internal subset
 * or any ENTITY declaration is rejected outright (no entity expansion at all),
 * nothing external is resolved, and only the color dictionaries are read.
 */
export function importITerm2(text: string, fileName: string, defaults: Record<UiThemeRole, string>): ImportOutcome {
  if (/<!ENTITY/iu.test(text) || /<!DOCTYPE[^>]*\[/iu.test(text)) return {errors: ['XML entity declarations are not accepted in theme files.']};
  let root: OrderedNode[];
  try {
    const parser = new XMLParser({preserveOrder: true, processEntities: false, htmlEntities: false, ignoreDeclaration: true, ignorePiTags: true,
      ignoreAttributes: true, parseTagValue: false, trimValues: true});
    root = parser.parse(text) as OrderedNode[];
  } catch {
    return {errors: ['Not a valid iTerm2 color scheme (.itermcolors) file.']};
  }
  const plist = root.find(node => 'plist' in node)?.plist as OrderedNode[] | undefined;
  const dict = plist?.find(node => 'dict' in node)?.dict as OrderedNode[] | undefined;
  if (!dict) return {errors: ['Not an iTerm2 color scheme: no color dictionary.']};
  const warnings = new Set<string>();
  const colors = new Map<string, string>();
  for (const [key, value] of plistDict(dict)) {
    if (!('dict' in value)) continue;
    const components = new Map(plistDict(value.dict as OrderedNode[]).map(([name, node]) => [name, node]));
    const channel = (name: string) => {
      const node = components.get(`${name} Component`);
      const number = node && ('real' in node || 'integer' in node) ? Number(textOf((node.real ?? node.integer) as OrderedNode[])) : NaN;
      return Number.isFinite(number) ? Math.max(0, Math.min(255, Math.round(number * 255))) : undefined;
    };
    const [red, green, blue] = [channel('Red'), channel('Green'), channel('Blue')];
    if (red === undefined || green === undefined || blue === undefined) continue;
    const space = components.get('Color Space');
    const spaceName = space && 'string' in space ? textOf(space.string as OrderedNode[]) : '';
    if (spaceName && spaceName !== 'sRGB' && spaceName !== 'Calibrated') warnings.add(`Some colors use the ${sanitizeName(spaceName)} color space; their components were read as sRGB.`);
    colors.set(key, hexColor({red, green, blue}));
  }
  const ansi = Array.from({length: 16}, (_, index) => colors.get(`Ansi ${index} Color`));
  const background = colors.get('Background Color');
  const foreground = colors.get('Foreground Color');
  const missing = [...missingAnsi(ansi), ...(!background ? ['Background Color'] : []), ...(!foreground ? ['Foreground Color'] : [])];
  if (missing.length) return {errors: [`Not a complete iTerm2 color scheme: missing ${missing.join(', ')}.`]};
  const terminal: TerminalPalette = {background: background!, foreground: foreground!, ansi: ansi as string[],
    ...(colors.get('Selection Color') ? {selectionBackground: colors.get('Selection Color')!} : {}),
    ...(colors.get('Selected Text Color') ? {selectionForeground: colors.get('Selected Text Color')!} : {}),
    ...(colors.get('Cursor Color') ? {cursor: colors.get('Cursor Color')!} : {})};
  const known = new Set([...Array.from({length: 16}, (_, index) => `Ansi ${index} Color`), 'Background Color', 'Foreground Color', 'Selection Color', 'Selected Text Color', 'Cursor Color']);
  const extra = [...colors.keys()].filter(key => !known.has(key));
  if (extra.length) warnings.add(`iTerm2-only colors have no NMSh role and were not imported: ${extra.slice(0, 6).map(sanitizeName).join(', ')}${extra.length > 6 ? '…' : ''}.`);
  return terminalResult('iterm2', fileStem(fileName), terminal, defaults, [...warnings]);
}

// ---- WezTerm ---------------------------------------------------------------

export const WEZTERM_LUA_GUIDANCE = 'WezTerm Lua configuration is executable and is never evaluated. Export or choose a declarative WezTerm TOML color scheme (with a [colors] table) and import that instead.';

export function looksLikeLua(text: string, fileName: string): boolean {
  return /\.lua$/iu.test(fileName) || /\brequire\s*\(?\s*["']wezterm["']/u.test(text) || /^\s*return\s*\{/mu.test(text) || /^\s*local\s+\w+\s*=/mu.test(text);
}

/** Declarative WezTerm TOML color schemes: `[colors]` (ansi, brights, foreground, background, selection, cursor) and `[metadata] name`. */
export function importWezTermToml(data: Record<string, unknown>, fileName: string, defaults: Record<UiThemeRole, string>): ImportOutcome {
  const colors = isRecord(data.colors) ? data.colors : undefined;
  if (!colors) return {errors: ['Not a WezTerm color scheme: no [colors] table.']};
  const list = (value: unknown) => Array.isArray(value) && value.length === 8 ? value.map(hex) : Array(8).fill(undefined);
  const ansi = [...list(colors.ansi), ...list(colors.brights)];
  const background = hex(colors.background);
  const foreground = hex(colors.foreground);
  const missing = [...missingAnsi(ansi), ...(!background ? ['background'] : []), ...(!foreground ? ['foreground'] : [])];
  if (missing.length) return {errors: [`Not a complete WezTerm color scheme: missing ${missing.join(', ')}.`]};
  const known = new Set(['ansi', 'brights', 'foreground', 'background', 'selection_bg', 'selection_fg', 'cursor_bg', 'cursor_fg', 'cursor_border']);
  const extra = Object.keys(colors).filter(key => !known.has(key));
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const name = typeof metadata.name === 'string' ? metadata.name : fileStem(fileName);
  const terminal: TerminalPalette = {background: background!, foreground: foreground!, ansi: ansi as string[],
    ...(hex(colors.selection_bg) ? {selectionBackground: hex(colors.selection_bg)!} : {}),
    ...(hex(colors.selection_fg) ? {selectionForeground: hex(colors.selection_fg)!} : {}),
    ...(hex(colors.cursor_bg) ? {cursor: hex(colors.cursor_bg)!} : {})};
  const ignoredTables = Object.keys(data).filter(key => key !== 'colors' && key !== 'metadata');
  return terminalResult('wezterm', name, terminal, defaults, [
    ...(extra.length ? [`WezTerm color keys without an NMSh role were not imported: ${extra.slice(0, 6).join(', ')}${extra.length > 6 ? '…' : ''}.`] : []),
    ...(ignoredTables.length ? [`Non-color tables were ignored: ${ignoredTables.slice(0, 6).join(', ')}.`] : []),
  ]);
}

// ---- Base24 ----------------------------------------------------------------

// Base24 styling 0.1.3: the documented ANSI 0–15 sources.
const BASE24_ANSI = ['base00', 'base08', 'base0b', 'base0a', 'base0d', 'base0e', 'base0c', 'base05', 'base03', 'base12', 'base14', 'base13', 'base16', 'base17', 'base15', 'base07'];

function schemeColors(data: Record<string, unknown>): Record<string, string> {
  const source = isRecord(data.palette) ? data.palette : data;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const parsed = hex(value);
    if (/^base[01][0-9a-f]$/iu.test(key) && parsed) out[key.toLowerCase()] = parsed;
  }
  return out;
}

/**
 * Base24 (tinted-theming): all 24 colors are required; ANSI comes from the
 * spec's documented terminal mapping. Nothing missing is guessed.
 */
export function importBase24(data: Record<string, unknown>, defaults: Record<UiThemeRole, string>): ImportOutcome {
  const colors = schemeColors(data);
  const keys = [...Array.from({length: 16}, (_, index) => `base0${index.toString(16)}`), ...Array.from({length: 8}, (_, index) => `base1${index}`)];
  const missing = keys.filter(key => !colors[key]);
  if (missing.length) return {errors: [`Not a complete Base24 scheme: missing ${missing.join(', ')}.`]};
  const name = typeof data.name === 'string' ? data.name : typeof data.scheme === 'string' ? data.scheme : 'Imported Base24';
  const terminal: TerminalPalette = {background: colors.base00!, foreground: colors.base05!, ansi: BASE24_ANSI.map(key => colors[key]!),
    selectionBackground: colors.base02!, cursor: colors.base05!};
  const {theme, mapping} = themeFromTerminal(name, 'base24', terminal, defaults);
  // Base24 names its semantic slots, so the dark-surface and comment roles come from them directly.
  if (theme.dark) theme.ui = {...theme.ui, subtle: colors.base03!, separator: colors.base03!, selection: colors.base02!, secondary: colors.base04!};
  theme.prompt.cwd = colors.base02!;
  return finish('base24', theme, [...mapping, {role: 'Path / selection / muted', from: 'base02 / base02 / base03'}],
    [LOSSY, 'base09, base0F, base10, base11 and base06 have no NMSh role and were not imported.',
      theme.dark ? 'Interpreted as a dark scheme (dark base00).' : 'Interpreted as a light scheme (light base00).'], theme.name);
}

// ---- Oh My Posh ------------------------------------------------------------

const OMP_ROLE: Record<string, PromptThemeRole> = {path: 'cwd', git: 'gitBranch', node: 'node', go: 'go', python: 'python', docker: 'docker',
  kubectl: 'kubernetes', session: 'project', project: 'project', os: 'project'};

/**
 * Oh My Posh config (JSON, YAML or TOML, already parsed as data). Only
 * deterministic appearance facts are read: literal hex colors, `p:name`
 * references into the static `palette`, and segment types as role hints.
 * Templates, `*_templates`, conditional `palettes`, named terminal colors,
 * remote/inherited configs, commands and prompt logic are never evaluated;
 * each becomes a warning, and roles without a source keep NMSh defaults.
 */
export function importOhMyPosh(data: Record<string, unknown>, fileName: string, base: CustomTheme): ImportOutcome {
  const warnings = new Set<string>(['Oh My Posh prompt logic, segments and templates are not imported; only static colors become an NMSh Native theme.']);
  const palette = isRecord(data.palette) ? data.palette : {};
  if (data.palettes !== undefined) warnings.add('Conditional palettes (palettes/template) are dynamic and were ignored; the static palette was used.');
  if (data.extends !== undefined || (typeof data.$schema === 'string' && !/oh-my-posh/u.test(data.$schema))) warnings.add('Inherited or remote configuration is never fetched or merged.');
  const unresolved = new Set<string>();
  const resolve = (value: unknown, depth = 0): string | undefined => {
    if (typeof value !== 'string' || depth > 4) return undefined;
    const literal = hex(value);
    if (literal) return literal;
    const reference = /^p:([A-Za-z0-9_.-]{1,64})$/u.exec(value.trim());
    if (reference) {
      const target = palette[reference[1]!];
      const resolved = resolve(target, depth + 1);
      if (!resolved) unresolved.add(value.trim());
      return resolved;
    }
    if (value.trim() && !/^(?:transparent|parentBackground|parentForeground|background|foreground|accent)$/u.test(value.trim())) unresolved.add(sanitizeName(value.trim()));
    return undefined;
  };
  const prompt: Partial<Record<PromptThemeRole, string>> = {};
  const mapping: RoleMapping[] = [];
  let accent: string | undefined;
  let dynamic = 0;
  const blocks = Array.isArray(data.blocks) ? data.blocks.slice(0, 32) : [];
  for (const block of blocks) {
    if (!isRecord(block) || !Array.isArray(block.segments)) continue;
    for (const segment of block.segments.slice(0, 64)) {
      if (!isRecord(segment)) continue;
      if (segment.foreground_templates !== undefined || segment.background_templates !== undefined) dynamic++;
      const type = typeof segment.type === 'string' ? segment.type : '';
      const fill = resolve(segment.background) ?? resolve(segment.foreground);
      if (!fill) continue;
      accent ??= fill;
      const role = OMP_ROLE[type];
      if (role && !prompt[role]) { prompt[role] = fill; mapping.push({role: ROLE_LABELS[role], from: `${sanitizeName(type)} segment`}); }
      if ((type === 'status' || type === 'exit') && !prompt.success) { prompt.success = fill; mapping.push({role: 'Success', from: `${type} segment`}); }
    }
  }
  if (dynamic) warnings.add(`${dynamic} dynamic color template${dynamic === 1 ? ' was' : 's were'} ignored (for example foreground_templates); their static colors were used.`);
  if (unresolved.size) warnings.add(`Colors that are not static hex values were not imported: ${[...unresolved].slice(0, 6).join(', ')}${unresolved.size > 6 ? '…' : ''}.`);
  // Palette entries can still name roles explicitly when segments use other types.
  for (const [key, value] of Object.entries(palette)) {
    const role = PROMPT_THEME_ROLES.find(candidate => candidate.toLowerCase() === key.toLowerCase());
    const color = resolve(value);
    if (role && color && !prompt[role]) { prompt[role] = color; mapping.push({role: ROLE_LABELS[role], from: `palette.${sanitizeName(key)}`}); }
  }
  if (!Object.keys(prompt).length) return {errors: ['No static Oh My Posh segment colors were found to build an NMSh theme from.']};
  const kept = PROMPT_THEME_ROLES.filter(role => !prompt[role]);
  if (kept.length) warnings.add(`No Oh My Posh source for ${kept.map(role => ROLE_LABELS[role]).join(', ')}; ${kept.length === 1 ? 'it keeps' : 'they keep'} ${base.name} colors.`);
  warnings.add('Oh My Posh does not define a terminal background; text tiers assume a dark terminal (change it in the editor).');
  const name = sanitizeName(fileStem(fileName).replace(/\.omp$/u, '')) || 'Oh My Posh theme';
  const theme: CustomTheme = {...structuredClone(base), name, basedOn: 'Oh My Posh import', dark: true,
    prompt: {...base.prompt, ...prompt}, ui: {...base.ui, ...(accent ? {accent} : {}),
      ...(prompt.success ? {success: prompt.success} : {}), ...(prompt.failure ? {failure: prompt.failure} : {})}};
  delete theme.terminal;
  if (accent) mapping.push({role: 'Accent', from: 'first colored segment'});
  return finish('oh-my-posh', theme, mapping, [...warnings], name);
}

// ---- Dispatcher ------------------------------------------------------------

function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/u).pop() ?? fileName;
  return sanitizeName(base.replace(/\.(?:json|ya?ml|toml|conf|itermcolors|theme)$/iu, '')) || 'Imported theme';
}

function parseYaml(text: string): unknown {
  const document = parseDocument(text, {prettyErrors: false, uniqueKeys: false, logLevel: 'silent', customTags: []});
  if (document.errors.length) throw new Error('invalid YAML');
  return document.toJS({maxAliasCount: 64});
}

function isOhMyPosh(data: unknown): data is Record<string, unknown> {
  return isRecord(data) && (Array.isArray(data.blocks) || (typeof data.$schema === 'string' && /oh-my-posh/u.test(data.$schema)));
}

function isScheme(data: unknown): data is Record<string, unknown> {
  return isRecord(data) && Boolean(schemeColors(data).base00);
}

function schemeImport(data: Record<string, unknown>, text: string, defaults: Record<UiThemeRole, string>, forced?: ThemeSourceKind): ImportOutcome {
  const colors = schemeColors(data);
  const base24 = forced === 'base24' || (forced !== 'base16' && (data.system === 'base24' || Object.keys(colors).some(key => /^base1[0-7]$/u.test(key))));
  if (base24) return importBase24(data, defaults);
  const result = importBase16(JSON.stringify(data), defaults) ?? importBase16(text, defaults);
  if (!result) return {errors: ['Not a complete Base16 scheme: base00–base0E are required.']};
  return finish('base16', result.theme, [{role: 'Prompt and UI roles', from: 'Base16 slots (see the Base16 mapping in the docs)'}],
    [...result.warnings, result.theme.dark ? 'Interpreted as a dark scheme (dark base00).' : 'Interpreted as a light scheme (light base00).'], result.theme.name);
}

/**
 * Parses one local theme file (already read, size-checked text) as the chosen
 * format, or detects it. Data only; see the module comment for guarantees.
 */
export function importThemeSource(text: string, fileName: string, defaults: Record<UiThemeRole, string>, base: CustomTheme, format: ImportFormatChoice = 'auto'): ImportOutcome {
  if (text.length > IMPORT_SIZE_LIMIT) return {errors: ['File is larger than 256 KiB.']};
  if (text.includes('\u0000')) return {errors: ['Binary files are not theme files.']};
  const extension = /\.([a-z0-9]+)$/iu.exec(fileName)?.[1]?.toLowerCase() ?? '';
  const want = (kind: ThemeSourceKind) => format === 'auto' || format === kind;
  if (format === 'wezterm' || extension === 'lua') {
    if (looksLikeLua(text, fileName)) return {errors: [WEZTERM_LUA_GUIDANCE]};
  }
  if (format === 'iterm2' || extension === 'itermcolors' || (format === 'auto' && /<plist[\s>]/u.test(text))) return importITerm2(text, fileName, defaults);
  if (format === 'kitty') return importKitty(text, fileName, defaults);
  if (format === 'ghostty') return importGhostty(text, fileName, defaults);
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  if (json !== undefined) {
    if (isRecord(json) && json.schema === THEME_SCHEMA && want('nmsh')) {
      const result = validateTheme(json);
      return result.ok ? {format: 'nmsh', theme: result.theme, mapping: [], warnings: result.warnings, sourceName: result.theme.name} : {errors: result.errors};
    }
    if (isOhMyPosh(json) && want('oh-my-posh')) return importOhMyPosh(json, fileName, base);
    if (want('windows-terminal') && (format === 'windows-terminal' || (isRecord(json) && 'brightBlack' in json))) {
      const result = importWindowsTerminal(text, defaults);
      if (!result) return {errors: ['Not a complete Windows Terminal color scheme.']};
      const terminal = windowsTerminalPalette(json as Record<string, unknown>);
      return terminal ? terminalResult('windows-terminal', result.theme.name, terminal, defaults, [])
        : finish('windows-terminal', result.theme, [], [...result.warnings], result.theme.name);
    }
    if (isScheme(json) && (want('base16') || want('base24'))) return schemeImport(json, text, defaults, format === 'auto' ? undefined : format);
    return {errors: ['This JSON is not an NMSh theme, Oh My Posh config, Windows Terminal scheme or Base16/Base24 scheme.']};
  }
  if (extension === 'toml' || format === 'wezterm' || (format === 'oh-my-posh' && /^\s*\[/mu.test(text))) {
    let data: unknown;
    try { data = parseToml(text); } catch { return {errors: [looksLikeLua(text, fileName) ? WEZTERM_LUA_GUIDANCE : 'Not valid TOML.']}; }
    if (isOhMyPosh(data) && want('oh-my-posh')) return importOhMyPosh(data, fileName, base);
    if (isRecord(data) && isRecord(data.colors) && want('wezterm')) return importWezTermToml(data, fileName, defaults);
    return {errors: ['This TOML is not an Oh My Posh config or a WezTerm color scheme.']};
  }
  if (format === 'auto' && looksLikeLua(text, fileName)) return {errors: [WEZTERM_LUA_GUIDANCE]};
  // Line-oriented terminal configs, detected by their own color syntax before YAML.
  if (format === 'auto' && /^\s*palette\s*=\s*\d+\s*=/mu.test(text)) return importGhostty(text, fileName, defaults);
  if (format === 'auto' && /^\s*color\d{1,2}\s+#?[0-9a-fA-F]{3,6}\s*$/mu.test(text)) return importKitty(text, fileName, defaults);
  let yaml: unknown;
  try { yaml = parseYaml(text); } catch { return {errors: ['The file is not a recognized theme format (NMSh, Base16/Base24, Windows Terminal, Oh My Posh, Kitty, Ghostty, iTerm2, WezTerm TOML).']}; }
  if (isOhMyPosh(yaml) && want('oh-my-posh')) return importOhMyPosh(yaml, fileName, base);
  if (isScheme(yaml) && (want('base16') || want('base24'))) return schemeImport(yaml, text, defaults, format === 'auto' ? undefined : format);
  return {errors: ['The file is not a recognized theme format (NMSh, Base16/Base24, Windows Terminal, Oh My Posh, Kitty, Ghostty, iTerm2, WezTerm TOML).']};
}

function windowsTerminalPalette(json: Record<string, unknown>): TerminalPalette | undefined {
  const keys = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
    'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite'];
  const ansi = keys.map(key => hex(json[key]));
  const background = hex(json.background);
  const foreground = hex(json.foreground);
  if (ansi.some(value => !value) || !background || !foreground) return undefined;
  return {background, foreground, ansi: ansi as string[], ...(hex(json.selectionBackground) ? {selectionBackground: hex(json.selectionBackground)!} : {}),
    ...(hex(json.cursorColor) ? {cursor: hex(json.cursorColor)!} : {})};
}

export const IMPORT_FORMAT_CHOICES: readonly ImportFormatChoice[] = ['auto', 'nmsh', 'base16', 'base24', 'windows-terminal', 'oh-my-posh', 'kitty', 'ghostty', 'iterm2', 'wezterm'];
export const importFormatLabel = (format: ImportFormatChoice): string => format === 'auto' ? 'Detect automatically' : THEME_SOURCE_LABELS[format];

