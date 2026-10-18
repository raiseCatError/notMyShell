import {randomBytes} from 'node:crypto';
import {normalizeCustomTheme, sanitizeName, type CustomTheme} from './customTheme.js';

/**
 * The Native theme library: every user-owned NMSh theme as one asset with a
 * stable id. Imported is provenance, never another renderer: an imported
 * asset is ordinary NMSh Theme JSON plus where it came from, and it keeps
 * working when the source application, file or network is gone.
 *
 * Canonical state is `themes` (the assets) and `nmsh.themeId` (the asset a
 * `custom` palette uses). `customTheme` is a deterministic mirror of that
 * asset, rewritten by normalization on every load and save, so the existing
 * renderers and older NMSh versions keep reading one theme. A stored
 * `customTheme` is only ever read as input when migrating a configuration
 * that has no library yet.
 */

/** Bounded so a damaged or hostile configuration cannot grow without limit. */
export const THEME_LIBRARY_LIMIT = 64;
/** The asset a pre-library `customTheme` migrates into. */
export const LEGACY_THEME_ID = 'legacy-custom';

export const THEME_SOURCE_KINDS = ['nmsh', 'base16', 'base24', 'windows-terminal', 'oh-my-posh', 'starship', 'kitty', 'ghostty', 'iterm2', 'wezterm'] as const;
export type ThemeSourceKind = typeof THEME_SOURCE_KINDS[number];
export const THEME_SOURCE_LABELS: Record<ThemeSourceKind, string> = {
  nmsh: 'NMSh Theme JSON', base16: 'Base16', base24: 'Base24', 'windows-terminal': 'Windows Terminal', 'oh-my-posh': 'Oh My Posh', starship: 'Starship',
  kitty: 'Kitty', ghostty: 'Ghostty', iterm2: 'iTerm2', wezterm: 'WezTerm',
};

/** Where an imported asset came from. Local-only: never part of a portable export. */
export interface ThemeOrigin {
  kind: ThemeSourceKind;
  /** The source's own scheme name or file name (no directories). */
  sourceName?: string;
  /** The local file it was read from, for this machine's display only. */
  sourcePath?: string;
  importerVersion?: number;
  importedAt?: string;
}

export interface ThemeAsset {
  id: string;
  theme: CustomTheme;
  /** Present only for imported assets; its presence is what makes the category Imported. */
  origin?: ThemeOrigin;
  createdAt?: string;
  /** An imported asset edited in NMSh after import (the source file is never touched). */
  modified?: boolean;
}

export type ThemeCategory = 'custom' | 'imported';
export const categoryOf = (asset: ThemeAsset): ThemeCategory => asset.origin ? 'imported' : 'custom';

/** Current importer behavior version, recorded with each import. */
export const IMPORTER_VERSION = 2;

const ID = /^[a-z0-9][a-z0-9-]{2,39}$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isoDate = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : undefined;

export function newThemeId(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    const id = `t-${randomBytes(6).toString('hex')}`;
    if (!taken.has(id)) return id;
  }
}

function normalizeOrigin(value: unknown): ThemeOrigin | undefined {
  if (!isRecord(value) || !THEME_SOURCE_KINDS.includes(value.kind as ThemeSourceKind)) return undefined;
  const sourceName = typeof value.sourceName === 'string' ? sanitizeName(value.sourceName) : '';
  const sourcePath = typeof value.sourcePath === 'string' && value.sourcePath.length <= 1024 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value.sourcePath)
    ? value.sourcePath : undefined;
  const importerVersion = typeof value.importerVersion === 'number' && Number.isInteger(value.importerVersion) && value.importerVersion > 0
    ? value.importerVersion : undefined;
  const importedAt = isoDate(value.importedAt);
  return {kind: value.kind as ThemeSourceKind, ...(sourceName ? {sourceName} : {}), ...(sourcePath ? {sourcePath} : {}),
    ...(importerVersion ? {importerVersion} : {}), ...(importedAt ? {importedAt} : {})};
}

export function normalizeThemeAsset(value: unknown): ThemeAsset | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !ID.test(value.id)) return undefined;
  const theme = normalizeCustomTheme(value.theme);
  if (!theme) return undefined;
  const origin = normalizeOrigin(value.origin);
  const createdAt = isoDate(value.createdAt);
  return {id: value.id, theme, ...(origin ? {origin} : {}), ...(createdAt ? {createdAt} : {}),
    ...(origin && value.modified === true ? {modified: true} : {})};
}

export interface NormalizedLibrary {
  themes: ThemeAsset[];
  /** The asset the `custom` palette uses, when it exists. */
  themeId?: string;
}

/**
 * Library normalization and the one-time migration: a configuration without
 * `themes` turns a valid legacy `customTheme` into one Custom asset (kept
 * active through the same `custom` palette). Malformed assets are dropped
 * individually; duplicate ids keep the first; the library is bounded.
 */
export function normalizeThemeLibrary(themes: unknown, legacyCustom: unknown, themeId: unknown): NormalizedLibrary {
  if (!Array.isArray(themes)) {
    const legacy = normalizeCustomTheme(legacyCustom);
    return legacy ? {themes: [{id: LEGACY_THEME_ID, theme: legacy}], themeId: LEGACY_THEME_ID} : {themes: []};
  }
  const seen = new Set<string>();
  const assets: ThemeAsset[] = [];
  for (const item of themes.slice(0, THEME_LIBRARY_LIMIT * 2)) {
    const asset = normalizeThemeAsset(item);
    if (!asset || seen.has(asset.id)) continue;
    seen.add(asset.id);
    assets.push(asset);
    if (assets.length >= THEME_LIBRARY_LIMIT) break;
  }
  const active = typeof themeId === 'string' && seen.has(themeId) ? themeId : undefined;
  return {themes: assets, ...(active ? {themeId: active} : {})};
}

export function findTheme(themes: readonly ThemeAsset[], id: string | undefined): ThemeAsset | undefined {
  return id === undefined ? undefined : themes.find(asset => asset.id === id);
}

/** Display line for an asset's provenance: `Imported from Ghostty · Catppuccin`, with `· Modified` after edits. */
export function provenanceLabel(asset: ThemeAsset): string {
  if (!asset.origin) return asset.theme.basedOn ? `Custom · based on ${asset.theme.basedOn}` : 'Custom';
  const source = [THEME_SOURCE_LABELS[asset.origin.kind], asset.origin.sourceName].filter(Boolean).join(' · ');
  return `Imported from ${source}${asset.modified ? ' · Modified' : ''}`;
}

export function libraryCounts(themes: readonly ThemeAsset[]): {imported: number; custom: number} {
  const imported = themes.filter(asset => asset.origin).length;
  return {imported, custom: themes.length - imported};
}

/** `2 imported · 3 custom`, or undefined for an empty library. */
export function librarySummary(themes: readonly ThemeAsset[]): string | undefined {
  const {imported, custom} = libraryCounts(themes);
  const parts = [imported ? `${imported} imported` : '', custom ? `${custom} custom` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** A unique display name in the library ("Name", "Name 2", ...); names never identify assets. */
export function uniqueThemeName(themes: readonly ThemeAsset[], wanted: string, except?: string): string {
  const base = sanitizeName(wanted) || 'Theme';
  const taken = new Set(themes.filter(asset => asset.id !== except).map(asset => asset.theme.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; ; index++) {
    const suffix = ` ${index}`;
    const candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export type LibraryResult<T> = {ok: true; value: T} | {ok: false; error: string};

/** A new asset in the library; fails cleanly when the library is full. */
export function addThemeAsset(themes: readonly ThemeAsset[], theme: CustomTheme, origin?: ThemeOrigin, now = new Date()): LibraryResult<{themes: ThemeAsset[]; asset: ThemeAsset}> {
  if (themes.length >= THEME_LIBRARY_LIMIT) return {ok: false, error: `The theme library is full (${THEME_LIBRARY_LIMIT} themes). Delete one first.`};
  const asset: ThemeAsset = {id: newThemeId(new Set(themes.map(item => item.id))),
    theme: {...structuredClone(theme), name: uniqueThemeName(themes, theme.name)},
    ...(origin ? {origin: {...origin}} : {}), createdAt: now.toISOString()};
  return {ok: true, value: {themes: [...themes, asset], asset}};
}

/** Saves edited colors/name; an imported asset becomes Modified (its source file is never touched). */
export function updateThemeAsset(themes: readonly ThemeAsset[], id: string, theme: CustomTheme): LibraryResult<ThemeAsset[]> {
  const current = findTheme(themes, id);
  if (!current) return {ok: false, error: 'That theme no longer exists.'};
  const changed = JSON.stringify(current.theme) !== JSON.stringify(theme);
  const next: ThemeAsset = {...current, theme: {...structuredClone(theme), name: uniqueThemeName(themes, theme.name, id)},
    ...(current.origin && (changed || current.modified) ? {modified: true} : {})};
  return {ok: true, value: themes.map(asset => asset.id === id ? next : asset)};
}

export function renameThemeAsset(themes: readonly ThemeAsset[], id: string, name: string): LibraryResult<ThemeAsset[]> {
  const current = findTheme(themes, id);
  if (!current) return {ok: false, error: 'That theme no longer exists.'};
  const clean = sanitizeName(name);
  if (!clean) return {ok: false, error: 'Name must be 1–48 printable characters.'};
  return updateThemeAsset(themes, id, {...current.theme, name: clean});
}

/** A Custom copy (no provenance) whose Based on names the original. */
export function duplicateThemeAsset(themes: readonly ThemeAsset[], id: string, now = new Date()): LibraryResult<{themes: ThemeAsset[]; asset: ThemeAsset}> {
  const current = findTheme(themes, id);
  if (!current) return {ok: false, error: 'That theme no longer exists.'};
  return addThemeAsset(themes, {...current.theme, name: `${current.theme.name.slice(0, 43)} copy`, basedOn: current.theme.name}, undefined, now);
}

export function removeThemeAsset(themes: readonly ThemeAsset[], id: string): ThemeAsset[] {
  return themes.filter(asset => asset.id !== id);
}
