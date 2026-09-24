import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {promptConfigurationPath} from '../configuration/paths.js';
import {
  normalizeConnectorStyle,
  normalizeEdgeStyle,
  type PowerlineConnectorStyle,
  type PowerlineEdgeStyle,
  type PowerlineShape,
} from './powerline.js';

export type ContextPlacement = 'header' | 'composer';
export type ComposerLayout = 'oneLine' | 'twoLine';
export type GlyphStyle = 'nerd' | 'safe';
export type SessionRetention = 100 | 500 | 1000 | 5000 | null;
export type ContextModuleId = 'project' | 'cwd' | 'gitBranch' | 'toolchain' | 'exitStatus';
export type ContextCondition = 'always' | 'inRepository' | 'nonzeroExit';
export type PromptProviderId = 'nmsh' | 'starship' | 'powerlevel10k';
export type NativeEndStyle = PowerlineEdgeStyle;
export type NativeStartStyle = PowerlineEdgeStyle;
export type NativeConnectorStyle = PowerlineConnectorStyle;
/** `nerd` shows Nerd Font module icons; a future `text` mode can join without migration. */
export type NativeIconMode = 'nerd' | 'off';
export type NativePaletteId = 'lavender' | 'brand' | 'cool' | 'warm' | 'grayscale';
export type NativeGapChoice = 'off' | 'compact' | 'normal';
/**
 * Rich Git state colors: `semantic` keeps meaningful Git colors under any
 * theme, `followTheme` derives them from the Main Prompt theme, `grayscale`
 * removes their hue. The branch itself always follows the theme.
 */
export type GitColorMode = 'semantic' | 'followTheme' | 'grayscale';
export const GIT_COLOR_MODES: readonly GitColorMode[] = ['semantic', 'followTheme', 'grayscale'];
/** One-cell softened connector: follow the Connector shape, off, or a fixed shape override. */
export type ConnectorFadeStyle = 'follow' | 'off' | PowerlineShape;
export const CONNECTOR_FADE_STYLES: readonly ConnectorFadeStyle[] = ['follow', 'off', 'wedge', 'flat', 'rounded', 'slash', 'backslash'];

export function normalizeGitColorMode(value: unknown): GitColorMode {
  return GIT_COLOR_MODES.includes(value as GitColorMode) ? value as GitColorMode : 'semantic';
}

export function normalizeConnectorFade(value: unknown): ConnectorFadeStyle {
  return CONNECTOR_FADE_STYLES.includes(value as ConnectorFadeStyle) ? value as ConnectorFadeStyle : 'follow';
}

export const NATIVE_PALETTE_IDS: readonly NativePaletteId[] = ['lavender', 'brand', 'cool', 'warm', 'grayscale'];

/** Retired theme ids keep working: Soft Semantic overlapped Brand / Semantic. */
export function normalizePaletteId(value: unknown, fallback: NativePaletteId = 'lavender'): NativePaletteId {
  if (value === 'semantic') return 'brand';
  return NATIVE_PALETTE_IDS.includes(value as NativePaletteId) ? value as NativePaletteId : fallback;
}

export interface ContextModuleConfig {
  id: ContextModuleId;
  visible: boolean;
  condition: ContextCondition;
  foreground?: string;
  background?: string;
}

export type HistoryColorMode = 'followPrompt' | 'theme' | 'grayscale';
export type DividerDensity = 'normal' | 'compact';

/** How historical command headers are presented; stored snapshots are never changed. */
export interface TranscriptAppearance {
  divider: boolean;
  historicalPrompt: boolean;
  historyColors: HistoryColorMode;
  /** Used when `historyColors` is `theme`. */
  historyTheme: NativePaletteId;
  dividerDensity: DividerDensity;
}

export const DEFAULT_TRANSCRIPT_APPEARANCE: TranscriptAppearance = {
  divider: true,
  historicalPrompt: true,
  historyColors: 'followPrompt',
  historyTheme: 'lavender',
  dividerDensity: 'normal',
};

export function normalizeTranscriptAppearance(value: unknown): TranscriptAppearance {
  if (!isRecord(value)) return {...DEFAULT_TRANSCRIPT_APPEARANCE};
  return {
    divider: typeof value.divider === 'boolean' ? value.divider : true,
    historicalPrompt: typeof value.historicalPrompt === 'boolean' ? value.historicalPrompt : true,
    historyColors: value.historyColors === 'theme' || value.historyColors === 'grayscale' ? value.historyColors : 'followPrompt',
    historyTheme: normalizePaletteId(value.historyTheme),
    dividerDensity: value.dividerDensity === 'compact' ? 'compact' : 'normal',
  };
}

export interface PromptConfiguration {
  provider: PromptProviderId;
  onboardingComplete: boolean;
  /** Missing in v0.3 configs; normalize to nerd to preserve their appearance. */
  glyphStyle: GlyphStyle;
  glyphChoiceComplete: boolean;
  /** Maximum unpinned presentation sessions; null disables rotation. */
  sessionRetention: SessionRetention;
  nmsh: {
    gapEnabled: boolean;
    startStyle: NativeStartStyle;
    connector: NativeConnectorStyle;
    endStyle: NativeEndStyle;
    palette: NativePaletteId;
    icons: NativeIconMode;
    connectorFade: ConnectorFadeStyle;
    gitColors: GitColorMode;
  };
  starship: {configPath: string | null};
  /** Optional overrides; null uses detection and the default ~/.p10k.zsh. Never written to. */
  powerlevel10k: {themePath: string | null; configPath: string | null};
  transcript: TranscriptAppearance;
  placement: ContextPlacement;
  composerLayout: ComposerLayout;
  modules: ContextModuleConfig[];
  separator: string;
  /** Spaces between colored context blocks; use spacing for padding inside each block. */
  gap: number;
  spacing: number;
}

export const DEFAULT_PROMPT_CONFIGURATION: PromptConfiguration = {
  provider: 'nmsh',
  onboardingComplete: false,
  glyphStyle: 'nerd',
  glyphChoiceComplete: false,
  sessionRetention: 1000,
  nmsh: {gapEnabled: true, startStyle: 'wedge', connector: 'wedge', endStyle: 'fadeWedge', palette: 'lavender', icons: 'nerd',
    connectorFade: 'follow', gitColors: 'semantic'},
  starship: {configPath: null},
  powerlevel10k: {themePath: null, configPath: null},
  transcript: {...DEFAULT_TRANSCRIPT_APPEARANCE},
  placement: 'header',
  composerLayout: 'twoLine',
  modules: [
    {id: 'project', visible: true, condition: 'always'},
    {id: 'cwd', visible: true, condition: 'always'},
    {id: 'gitBranch', visible: true, condition: 'inRepository'},
    {id: 'toolchain', visible: true, condition: 'always'},
    {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
  ],
  separator: '',
  gap: 1,
  spacing: 1,
};

const MODULE_IDS = new Set<ContextModuleId>(['project', 'cwd', 'gitBranch', 'toolchain', 'exitStatus']);
const CONDITIONS = new Set<ContextCondition>(['always', 'inRepository', 'nonzeroExit']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
}

function validSeparator(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8 && !/[\u0000-\u001f\u007f\u001b]/u.test(value);
}

export function normalizePromptConfiguration(value: unknown): PromptConfiguration {
  if (!isRecord(value)) return structuredClone(DEFAULT_PROMPT_CONFIGURATION);

  const promptValue = isRecord(value.prompt) ? value.prompt : value;
  const glyphStyle: GlyphStyle = value.glyphStyle === 'safe' ? 'safe' : 'nerd';
  // Existing configured installations keep their v0.3 appearance without a new wizard.
  const glyphChoiceComplete = value.glyphChoiceComplete === true || value.onboardingComplete === true;
  const sessionRetention: SessionRetention = value.sessionRetention === null
    ? null : [100, 500, 1000, 5000].includes(value.sessionRetention as number)
      ? value.sessionRetention as SessionRetention : 1000;
  const provider: PromptProviderId = promptValue.provider === 'starship' || promptValue.provider === 'powerlevel10k'
    ? promptValue.provider
    : 'nmsh';
  const p10kValue = isRecord(promptValue.powerlevel10k) ? promptValue.powerlevel10k : {};
  const optionalPath = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
  const powerlevel10k = {themePath: optionalPath(p10kValue.themePath), configPath: optionalPath(p10kValue.configPath)};
  const nativeValue = isRecord(promptValue.nmsh) ? promptValue.nmsh : promptValue;
  const starshipValue = isRecord(promptValue.starship) ? promptValue.starship : {};
  const endStyle = normalizeEdgeStyle(nativeValue.endStyle, 'fadeWedge');
  const startStyle = normalizeEdgeStyle(nativeValue.startStyle, 'wedge');
  const connector = normalizeConnectorStyle(nativeValue.connector);
  const icons: NativeIconMode = nativeValue.icons === 'off' || nativeValue.icons === false ? 'off' : 'nerd';
  const palette = normalizePaletteId(nativeValue.palette);
  const transcript = normalizeTranscriptAppearance(promptValue.transcript);
  const nmsh = {gapEnabled: typeof nativeValue.gapEnabled === 'boolean' ? nativeValue.gapEnabled : true,
    startStyle, connector, endStyle, palette, icons,
    connectorFade: normalizeConnectorFade(nativeValue.connectorFade), gitColors: normalizeGitColorMode(nativeValue.gitColors)};
  const starshipConfigPath = typeof starshipValue.configPath === 'string' && starshipValue.configPath.trim()
    ? starshipValue.configPath
    : null;

  const placement: ContextPlacement = value.placement === 'composer' ? 'composer' : 'header';
  const composerLayout: ComposerLayout = value.composerLayout === 'oneLine' ? 'oneLine' : 'twoLine';
  const spacing = typeof value.spacing === 'number' && Number.isFinite(value.spacing)
    ? Math.max(0, Math.min(3, Math.round(value.spacing)))
    : DEFAULT_PROMPT_CONFIGURATION.spacing;
  const gap = typeof value.gap === 'number' && Number.isFinite(value.gap)
    ? Math.max(0, Math.min(3, Math.round(value.gap)))
    : DEFAULT_PROMPT_CONFIGURATION.gap;
  const separator = validSeparator(value.separator) ? value.separator : DEFAULT_PROMPT_CONFIGURATION.separator;

  if (!Array.isArray(value.modules)) {
    return {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), provider, onboardingComplete: value.onboardingComplete === true,
      glyphStyle, glyphChoiceComplete, sessionRetention,
      nmsh, starship: {configPath: starshipConfigPath}, powerlevel10k, transcript, placement, composerLayout, spacing, gap, separator};
  }

  const modules: ContextModuleConfig[] = [];
  const seen = new Set<ContextModuleId>();
  for (const item of value.modules) {
    if (!isRecord(item) || typeof item.id !== 'string' || !MODULE_IDS.has(item.id as ContextModuleId)) continue;
    const id = item.id as ContextModuleId;
    if (seen.has(id)) continue;
    seen.add(id);
    const fallback = DEFAULT_PROMPT_CONFIGURATION.modules.find(module => module.id === id)!;
    const module: ContextModuleConfig = {
      id,
      visible: typeof item.visible === 'boolean' ? item.visible : fallback.visible,
      condition: typeof item.condition === 'string' && CONDITIONS.has(item.condition as ContextCondition)
        ? item.condition as ContextCondition
        : fallback.condition,
    };
    if (validColor(item.foreground)) module.foreground = item.foreground;
    if (validColor(item.background)) module.background = item.background;
    modules.push(module);
  }
  // Modules added in later releases join saved configurations at their
  // default position instead of silently staying absent.
  DEFAULT_PROMPT_CONFIGURATION.modules.forEach((fallback, defaultIndex) => {
    if (seen.has(fallback.id)) return;
    const later = DEFAULT_PROMPT_CONFIGURATION.modules.slice(defaultIndex + 1).map(module => module.id);
    const before = modules.findIndex(module => later.includes(module.id));
    modules.splice(before === -1 ? modules.length : before, 0, {...fallback});
  });

  return {provider, onboardingComplete: value.onboardingComplete === true, glyphStyle, glyphChoiceComplete, sessionRetention, nmsh, transcript, powerlevel10k,
    starship: {configPath: starshipConfigPath}, placement, composerLayout, modules, separator, spacing, gap};
}

export function loadPromptConfiguration(path = promptConfigurationPath()): PromptConfiguration {
  try {
    return normalizePromptConfiguration(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  }
}

export function savePromptConfiguration(configuration: PromptConfiguration, path = promptConfigurationPath()): void {
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const normalized = normalizePromptConfiguration(configuration);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  renameSync(temporary, path);
}

export function hasVisibleContextModule(
  configuration: PromptConfiguration,
  context?: {branch?: string; exitStatus?: number},
): boolean {
  return configuration.modules.some(module => module.visible
    && (module.condition !== 'inRepository' || Boolean(context?.branch))
    && (module.condition !== 'nonzeroExit' || (context?.exitStatus ?? 0) !== 0));
}

/** Gap presets map onto the stored gap width: compact keeps caps but no space. */
export function nativeGapChoice(configuration: PromptConfiguration): NativeGapChoice {
  if (!configuration.nmsh.gapEnabled) return 'off';
  return configuration.gap === 0 ? 'compact' : 'normal';
}

export function applyNativeGapChoice(configuration: PromptConfiguration, choice: NativeGapChoice): void {
  configuration.nmsh.gapEnabled = choice !== 'off';
  if (choice === 'compact') configuration.gap = 0;
  else if (choice === 'normal' && configuration.gap === 0) configuration.gap = 1;
}
