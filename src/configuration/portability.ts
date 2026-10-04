import {readFileSync} from 'node:fs';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../prompt/configuration.js';

/**
 * Versioned, human-readable NMSh settings transfer.
 *
 * One source of truth: categories are views over the existing
 * PromptConfiguration keys, and imports go through the same normalizer and
 * atomic save as every Settings change. Exports never contain onboarding
 * state, machine-specific absolute paths, history, transcripts, credentials
 * or anything outside config.json.
 */

export const PORTABLE_FORMAT = 'nmsh-settings';
export const PORTABLE_VERSION = 1;

/** Category id → dotted configuration paths it owns. Order is the export order. */
export const PORTABLE_CATEGORIES = {
  prompt: ['provider', 'promptSymbol', 'promptSymbolCustom', 'modules', 'separator', 'gap', 'spacing', 'placement',
    'nmsh.gapEnabled', 'nmsh.startStyle', 'nmsh.connector', 'nmsh.endStyle', 'nmsh.icons', 'nmsh.style', 'nmsh.connectorFade',
    'nmsh.connectorFadeColors', 'nmsh.gitEnabled', 'nmsh.gitColors', 'nmsh.gitGeometry', 'nmsh.gitConnectorFade', 'nmsh.mirrorRight', 'nmsh.styleProfiles'],
  theme: ['nmsh.palette', 'nmsh.vibrance', 'nmsh.accent', 'nmsh.themeId', 'themes', 'customTheme'],
  themeBridge: ['themeBridge'],
  chroma: ['presentation'],
  chrome: ['uiChrome', 'glyphStyle', 'cursor'],
  syntax: ['syntax'],
  transcript: ['transcript', 'outputFolding'],
  layout: ['composerLayout', 'composerPosition', 'transcriptPresentation'],
  suggestions: ['suggestions', 'suggestionsOnEmpty'],
  providers: ['history', 'picker', 'navigation', 'welcome'],
  statusStrip: ['statusStrip'],
  idle: ['idleVisuals', 'liveActivity'],
  notifications: ['notifications', 'sessionNotices'],
  tools: ['toolUpdateChecks', 'installSuggestions', 'ignoredInstallSuggestions', 'updateMode', 'updateFrequency'],
  sessions: ['liveSessionStartup', 'liveSessionMultiple', 'sessionRetention'],
  agents: ['agentActivity'],
  shell: ['shellBackend'],
  editor: ['openWith'],
} as const satisfies Record<string, readonly string[]>;

export type PortableCategory = keyof typeof PORTABLE_CATEGORIES;
export const CATEGORY_IDS = Object.keys(PORTABLE_CATEGORIES) as PortableCategory[];

/**
 * Never exported: per-machine onboarding progress and absolute paths to
 * provider config files (Starship, Powerlevel10k), which rarely exist at the
 * same place elsewhere and can reveal a home directory layout.
 */
export const NEVER_EXPORTED = ['onboardingComplete', 'toolsSetupComplete', 'glyphChoiceComplete', 'starship', 'powerlevel10k'] as const;

export interface PortableDocument {
  format: typeof PORTABLE_FORMAT;
  version: number;
  /** Informational only. */
  exportedBy?: string;
  exportedAt?: string;
  categories: Partial<Record<PortableCategory, Record<string, unknown>>>;
}

function getPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = target;
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[keys.at(-1)!] = structuredClone(value);
}

function portableThemes(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(asset => {
    const copy = structuredClone(asset) as {origin?: {sourcePath?: string}};
    if (copy.origin) delete copy.origin.sourcePath;
    return copy;
  });
}

export function parseCategories(text: string | undefined): PortableCategory[] {
  if (!text || text === 'all') return [...CATEGORY_IDS];
  const requested = text.split(',').map(item => item.trim()).filter(Boolean);
  const unknown = requested.filter(item => !(CATEGORY_IDS as string[]).includes(item));
  if (unknown.length) throw new Error(`Unknown setting categor${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')}. Known: ${CATEGORY_IDS.join(', ')}`);
  return requested as PortableCategory[];
}

export function exportSettings(configuration: PromptConfiguration, categories: readonly PortableCategory[] = CATEGORY_IDS,
  meta: {version?: string; now?: Date} = {}): PortableDocument {
  const normalized = normalizePromptConfiguration(configuration);
  const document: PortableDocument = {format: PORTABLE_FORMAT, version: PORTABLE_VERSION,
    ...(meta.version ? {exportedBy: `nmsh ${meta.version}`} : {}), ...(meta.now ? {exportedAt: meta.now.toISOString()} : {}), categories: {}};
  for (const category of categories) {
    const values: Record<string, unknown> = {};
    for (const path of PORTABLE_CATEGORIES[category]) {
      const value = getPath(normalized, path);
      // Imported themes keep their source path on this machine only; a transfer never carries it.
      if (value !== undefined) values[path] = path === 'themes' ? portableThemes(value) : structuredClone(value);
    }
    document.categories[category] = values;
  }
  return document;
}

export interface ImportChange {
  category: PortableCategory;
  path: string;
  before: unknown;
  after: unknown;
}

export interface ImportPlan {
  /** The configuration that would be saved. */
  next: PromptConfiguration;
  changes: ImportChange[];
  /** Values present in the file but rejected by validation (left as they were). */
  rejected: Array<{path: string; reason: string}>;
  /** Fields or categories this NMSh does not know; ignored, never written. */
  ignored: string[];
  /** Selected categories absent from the file. */
  missing: PortableCategory[];
}

export class PortableFormatError extends Error {}

/** Strict document validation: wrong format or a newer major version is refused, not guessed at. */
export function parsePortableDocument(text: string): PortableDocument {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new PortableFormatError('The file is not valid JSON.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PortableFormatError('The file is not an NMSh settings export.');
  const record = raw as Record<string, unknown>;
  if (record.format !== PORTABLE_FORMAT) throw new PortableFormatError(`Expected format "${PORTABLE_FORMAT}"; this file is not an NMSh settings export.`);
  if (!Number.isInteger(record.version) || (record.version as number) < 1) throw new PortableFormatError('The export has no valid version.');
  if ((record.version as number) > PORTABLE_VERSION) {
    throw new PortableFormatError(`This export uses settings format v${String(record.version)}; this NMSh reads up to v${PORTABLE_VERSION}. Update NMSh to import it.`);
  }
  if (!record.categories || typeof record.categories !== 'object' || Array.isArray(record.categories)) throw new PortableFormatError('The export has no categories.');
  return record as unknown as PortableDocument;
}

/**
 * Plan an import without touching disk: apply the selected categories over the
 * current configuration, run the normal normalizer, and report what changes,
 * what validation rejected and what was ignored.
 */
export function planImport(current: PromptConfiguration, document: PortableDocument, categories: readonly PortableCategory[] = CATEGORY_IDS): ImportPlan {
  const base = normalizePromptConfiguration(current);
  const draft = structuredClone(base) as unknown as Record<string, unknown>;
  const ignored: string[] = [];
  const missing: PortableCategory[] = [];
  for (const name of Object.keys(document.categories)) if (!(CATEGORY_IDS as string[]).includes(name)) ignored.push(`category ${name}`);
  const rejected: ImportPlan['rejected'] = [];
  const accepted: Array<{category: PortableCategory; path: string; value: unknown}> = [];
  for (const category of categories) {
    const values = document.categories[category];
    if (!values || typeof values !== 'object') { missing.push(category); continue; }
    const allowed = new Set<string>(PORTABLE_CATEGORIES[category]);
    for (const [path, value] of Object.entries(values)) {
      if (!allowed.has(path)) { ignored.push(`${category}.${path}`); continue; }
      // A scalar the normalizer would not keep as given is invalid here: reject it
      // instead of letting it silently become a default.
      if (value === null || typeof value !== 'object') {
        const probe = structuredClone(base) as unknown as Record<string, unknown>;
        setPath(probe, path, value);
        if (JSON.stringify(getPath(normalizePromptConfiguration(probe), path)) !== JSON.stringify(value)) {
          rejected.push({path, reason: 'not a valid value for this NMSh; kept the current one'});
          continue;
        }
      }
      setPath(draft, path, value);
      accepted.push({category, path, value});
    }
  }
  const next = normalizePromptConfiguration(draft);
  // Onboarding state and machine-local paths always stay as they are here.
  for (const key of NEVER_EXPORTED) (next as unknown as Record<string, unknown>)[key] = structuredClone((base as unknown as Record<string, unknown>)[key]);
  const changes: ImportChange[] = [];
  for (const {category, path} of accepted) {
    const before = getPath(base, path);
    const after = getPath(next, path);
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({category, path, before, after});
  }
  return {next, changes, rejected, ignored, missing};
}

function brief(value: unknown): string {
  const text = JSON.stringify(value) ?? 'unset';
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Plain-text preview for terminals and logs. */
export function formatImportPlan(plan: ImportPlan): string {
  const lines: string[] = [];
  if (plan.changes.length === 0) lines.push('No settings would change.');
  else {
    lines.push(`${plan.changes.length} setting${plan.changes.length === 1 ? '' : 's'} would change:`);
    for (const change of plan.changes) lines.push(`  ${change.category.padEnd(13)} ${change.path}: ${brief(change.before)} -> ${brief(change.after)}`);
  }
  for (const item of plan.rejected) lines.push(`  rejected      ${item.path}: ${item.reason}`);
  if (plan.ignored.length) lines.push(`Ignored (unknown to this NMSh): ${plan.ignored.join(', ')}`);
  if (plan.missing.length) lines.push(`Not in this file: ${plan.missing.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

export function readPortableFile(path: string): PortableDocument {
  return parsePortableDocument(readFileSync(path, 'utf8'));
}

export {DEFAULT_PROMPT_CONFIGURATION};
