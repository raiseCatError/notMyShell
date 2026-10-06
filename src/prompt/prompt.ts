import {colorLevel} from '../presentation/capabilities.js';
import {promptFacts, moduleFactContext, safeContextText, factAllowed} from '../context/facts.js';
import {routeModule} from '../context/surfaceRouter.js';
import {moduleDefinition} from '../context/modules.js';
import {declarativeSegments} from '../context/declarative.js';
import {moduleRelevantToCommand} from '../context/demand.js';
import {presentationNow} from '../presentation/environment.js';
import {findTheme} from '../appearance/themeLibrary.js';
import {accentedVariant, THEME_VARIANTS, type CatppuccinAccent, type ThemeVariant} from '../appearance/themeFamilies.js';
import type {CustomTheme} from '../appearance/customTheme.js';
import {paintDivider, treatmentAnimated, treatmentFor, type TreatmentSettings} from '../chroma/treatment.js';
import {applyVibrance, fromOklch, readableForeground, toOklch, type Vibrance} from '../chroma/color.js';
import {isReducedMotion} from '../presentation/environment.js';
import {displayWidth, repeatToWidth, stripAnsi} from '../util/text.js';
import type {PromptContext, ToolchainId} from '../shell/ShellContext.js';
import {foreground, UI_COLORS, type RgbColor, lazyForeground} from '../ui/palette.js';
import {neutralPromptText} from './powerline.js';
import {GLYPHS, getCurrentGlyphMode, moduleIcon, type ModuleIconId} from '../ui/glyphs.js';
import {
  DEFAULT_PROMPT_CONFIGURATION,
  type ContextModuleConfig,
  type ContextSurface,
  type GitColorMode,
  type NativeIconMode,
  type NativePaletteId,
  type PromptConfiguration,
} from './configuration.js';
import {homedir} from 'node:os';
import {matchesCommand, TOOLCHAIN_TRIGGERS} from './commandContext.js';
import {displayPath, PATH_DISPLAY_LEVELS} from './pathDisplay.js';
import {fitPowerlineBlocks, fitRightPowerlineBlocks, renderPowerlineBlocks, resolveConnectorFade, resolveFadeColors, type PowerlineShape, type PromptChroma, type PromptStyle, type RenderExtras, type PowerlineBlock} from './powerline.js';
import {desaturatePromptColor, type PromptSnapshot, type PromptSegmentSnapshot} from './snapshot.js';

const RESET = '\u001B[0m';
/** NMSh brand/project lavender. */
export const NMSH_BRAND_LAVENDER: RgbColor = {red: 166, green: 124, blue: 243};

export const FADE_TAIL_GLYPHS = GLYPHS.powerlineFade;

function safePromptText(value: string): string {
  return safeContextText(value);
}

interface RenderedModule {
  treatment?: TreatmentSettings;
  id: ContextModuleConfig['id'];
  role: PromptRole;
  style?: PromptStyle;
  text: string;
  foreground: RgbColor;
  background: RgbColor;
  compact?: boolean;
  geometry?: PowerlineShape;
  fade?: PowerlineShape | 'off';
  placement?: 'right';
}

/** Semantic identity of one rendered segment; themes color roles, not positions. */
/** Rich Git state roles; the branch (`gitBranch`) is identity and follows the theme. */
export const GIT_STATE_ROLES = ['gitClean', 'gitStaged', 'gitModified', 'gitUntracked', 'gitAhead', 'gitBehind',
  'gitDiverged', 'gitConflict', 'gitOperation'] as const;
export type GitStateRole = typeof GIT_STATE_ROLES[number];
/** `gitChanges` is legacy: snapshots from before per-state roles combined + ~ ? into one segment. */
export type PromptRole = 'project' | 'cwd' | 'gitBranch' | GitStateRole | 'gitChanges' | ToolchainId | 'kubernetes' | 'success' | 'failure';
type SegmentColors = {foreground: RgbColor; background: RgbColor};

const PROMPT_ROLES: readonly PromptRole[] = ['project', 'cwd', 'gitBranch', ...GIT_STATE_ROLES, 'gitChanges',
  'node', 'go', 'python', 'docker', 'kubernetes', 'success', 'failure'];

export function isGitStateRole(role: PromptRole): role is GitStateRole | 'gitChanges' {
  return role === 'gitChanges' || (GIT_STATE_ROLES as readonly string[]).includes(role);
}
export function isPromptRole(value: unknown): value is PromptRole {
  return PROMPT_ROLES.includes(value as PromptRole);
}

const hex = (value: string): RgbColor => colorFromHex(value, {red: 0, green: 0, blue: 0});
/** Newer themes give only backgrounds; text is chosen for >= 4.5:1 contrast on each. */
const auto = (backgrounds: Record<keyof ThemeRoles, string>): ThemeRoles => Object.fromEntries(Object.entries(backgrounds)
  .map(([role, value]) => [role, {background: hex(value), foreground: readableForeground(hex(value))}])) as ThemeRoles;
const pair = (backgroundHex: string, foregroundHex: string): SegmentColors => ({background: hex(backgroundHex), foreground: hex(foregroundHex)});
const STATUS_COLORS = {
  success: {background: UI_COLORS.success, foreground: hex('#10231b')},
  failure: {background: UI_COLORS.failure, foreground: hex('#f5f5f7')},
} as const;

export interface NativePromptTheme {
  id: NativePaletteId;
  label: string;
  description: string;
  /** Colors one segment from its semantic role. */
  colors(role: PromptRole): SegmentColors;
}

/**
 * Default Rich Git colors: meaning survives any Main Prompt theme. Symbols and
 * counts stay the primary signal; color is additional.
 */
export const GIT_SEMANTIC_COLORS: Record<GitStateRole, SegmentColors> = {
  gitClean: pair('#74b59a', '#0f231a'),
  gitStaged: pair('#3f9f7f', '#effbf6'),
  gitModified: pair('#d99a3e', '#2a1a04'),
  gitUntracked: pair('#4fb3c4', '#05232a'),
  gitAhead: pair('#3f9bd6', '#04202e'),
  gitBehind: pair('#4a68c8', '#f2f5ff'),
  gitDiverged: pair('#a45fc9', '#fbf3ff'),
  gitConflict: pair('#cd5c64', '#fff3f4'),
  gitOperation: pair('#e0bd4f', '#2a2305'),
};

type ThemeRoles = Record<Exclude<PromptRole, GitStateRole | 'gitChanges'>, SegmentColors>;

/** Follow Theme: each Git state borrows the theme's status or location colors. */
function themeGitColors(roles: ThemeRoles, role: GitStateRole | 'gitChanges'): SegmentColors {
  switch (role) {
    case 'gitClean': case 'gitStaged': case 'gitAhead': return roles.success;
    case 'gitModified': case 'gitChanges': case 'gitConflict': case 'gitOperation': return roles.failure;
    case 'gitUntracked': case 'gitBehind': case 'gitDiverged': return roles.cwd;
  }
}

function theme(id: NativePaletteId, label: string, description: string, roles: ThemeRoles): NativePromptTheme {
  return {id, label, description, colors: role => isGitStateRole(role) ? themeGitColors(roles, role) : roles[role]};
}

/** Grayscale Rich Git: the semantic lightness without hue, with readable text. */
function grayscaleGitColors(role: GitStateRole): SegmentColors {
  const background = desaturatePromptColor(GIT_SEMANTIC_COLORS[role].background);
  return {background, foreground: background.red > 150 ? hex('#111214') : hex('#f5f5f6')};
}

/**
 * The one place a role becomes colors. Rich Git state roles obey the Git
 * color mode; everything else, including the branch, follows the theme.
 */
export function promptRoleColors(role: PromptRole, palette: NativePaletteId, gitColors: GitColorMode): SegmentColors {
  const themeColors = (NATIVE_PROMPT_THEMES[palette] ?? NATIVE_PROMPT_THEMES.lavender).colors(role);
  if (!isGitStateRole(role) || gitColors === 'followTheme') return themeColors;
  const state = role === 'gitChanges' ? 'gitModified' : role;
  return gitColors === 'grayscale' ? grayscaleGitColors(state) : GIT_SEMANTIC_COLORS[state];
}

/*
 * Every theme is a complete role map so adjacent segments stay distinct in
 * any module order. Toolchain segments keep recognizable identities in the
 * semantic themes; Lavender Native and Grayscale stay within their family.
 */
export const NATIVE_PROMPT_THEMES = {
  lavender: theme('lavender', 'Lavender Native', 'lavender, violet and iris family', {
    project: pair('#a67cf3', '#faf6ff'),
    cwd: pair('#7a68b8', '#f3eeff'),
    gitBranch: pair('#5e45a6', '#f3eeff'),
    node: pair('#9a6fd6', '#faf6ff'),
    go: pair('#5d56c2', '#f5f6ff'),
    python: pair('#b08bcb', '#26173d'),
    docker: pair('#544ca8', '#f2f3ff'),
    kubernetes: pair('#6c5fc7', '#f4f2ff'),
    success: pair('#7c84cf', '#f5f6ff'),
    failure: pair('#b85c8f', '#fff3f8'),
  }),
  brand: theme('brand', 'Brand / Semantic', 'NMSh lavender with full tool brand colors', {
    project: pair('#a67cf3', '#faf6ff'),
    cwd: pair('#667085', '#f4f5f8'),
    gitBranch: pair('#3a3d46', '#ffffff'),
    node: pair('#3c873a', '#ffffff'),
    go: pair('#00add8', '#04222b'),
    python: pair('#ffd43b', '#2b2300'),
    docker: pair('#1d63ed', '#ffffff'),
    kubernetes: pair('#326ce5', '#ffffff'),
    ...STATUS_COLORS,
  }),
  cool: theme('cool', 'Cool First', 'periwinkle, slate and teal with tool colors', {
    project: pair('#6f7fd8', '#f5f5f7'),
    cwd: pair('#4a5878', '#dde3f0'),
    gitBranch: pair('#2f6e6c', '#e8f8f6'),
    node: pair('#5fa04e', '#0f2410'),
    go: pair('#29aed6', '#0b2530'),
    python: pair('#f2cf4a', '#2b240a'),
    docker: pair('#2f8ee0', '#f5f5f7'),
    kubernetes: pair('#3d6fd1', '#f5f7ff'),
    ...STATUS_COLORS,
  }),
  warm: theme('warm', 'Warm First', 'amber, sand, rust and olive', {
    project: pair('#d39b55', '#2a1a08'),
    cwd: pair('#7a6a58', '#f4ece2'),
    gitBranch: pair('#8f4b35', '#fbefe9'),
    node: pair('#8a9450', '#1c1f0a'),
    go: pair('#4a8585', '#f0f8f8'),
    python: pair('#d8b04c', '#2a2008'),
    docker: pair('#5c7fa3', '#f0f4f8'),
    kubernetes: pair('#6b7f99', '#f1f4f8'),
    ...STATUS_COLORS,
  }),
  grayscale: theme('grayscale', 'Grayscale', 'graphite to silver, no hue', {
    project: pair('#d0d2d6', '#16171a'),
    cwd: pair('#62656b', '#f0f1f3'),
    gitBranch: pair('#3e4045', '#f5f5f6'),
    node: pair('#a3a6ab', '#16171a'),
    go: pair('#74777d', '#f3f4f5'),
    python: pair('#bdbfc3', '#16171a'),
    docker: pair('#585b61', '#f0f1f3'),
    kubernetes: pair('#4c4f55', '#f0f1f3'),
    success: pair('#8e9196', '#111214'),
    failure: pair('#e4e5e7', '#111214'),
  }),
  aurora: theme('aurora', 'Aurora', 'polar green, teal and violet', auto({
    project: '#3fbf9a', cwd: '#2f6f8f', gitBranch: '#6a4fc4', node: '#5fae5a', go: '#2aa7c9', python: '#c9b94a',
    docker: '#3d7fd6', kubernetes: '#4b63c9', success: '#4fae84', failure: '#c45a7a',
  })),
  ocean: theme('ocean', 'Ocean', 'deep blue, sea teal and spray', auto({
    project: '#2f8fd8', cwd: '#25506e', gitBranch: '#1f7a8c', node: '#3b9e8f', go: '#3ab0d0', python: '#5fa8c8',
    docker: '#2c6fb5', kubernetes: '#3b5fb0', success: '#3aa58c', failure: '#d0605e',
  })),
  sunset: theme('sunset', 'Sunset', 'coral, plum and gold', auto({
    project: '#f08a5d', cwd: '#7a4a6a', gitBranch: '#b8456b', node: '#d9a441', go: '#c75d8a', python: '#f2c14e',
    docker: '#8a5fa8', kubernetes: '#6b4f9e', success: '#7fae5a', failure: '#d64550',
  })),
  // A forest, not "all green": moss and pine, warm bark for the path, amber sap, a muted teal stream and lichen blue.
  forest: theme('forest', 'Forest', 'moss, pine, bark, amber and stream teal', auto({
    project: '#6b9a52', cwd: '#5c4a36', gitBranch: '#2e6656', node: '#8fae5a', go: '#3f8a86', python: '#c9a24a',
    docker: '#5b7f86', kubernetes: '#4e6a8a', success: '#6fb072', failure: '#c0603e',
  })),
  rose: theme('rose', 'Rose', 'rose, mauve and apricot', auto({
    project: '#e07a9a', cwd: '#6e4a5a', gitBranch: '#a8507a', node: '#c98a9a', go: '#9a6aa8', python: '#e0a87a',
    docker: '#8a5a8a', kubernetes: '#7a5a9a', success: '#7aa88a', failure: '#c94a5a',
  })),
  nebula: theme('nebula', 'Nebula', 'violet, magenta and starlight blue', auto({
    project: '#8a4fd8', cwd: '#3a2f6e', gitBranch: '#c04fa8', node: '#4f6fd8', go: '#3fa8d8', python: '#d86fa8',
    docker: '#5a4fc8', kubernetes: '#6a3fb0', success: '#4fa89a', failure: '#e0507a',
  })),
  highContrast: theme('highContrast', 'High Contrast Neon', 'saturated neon on maximum contrast', auto({
    project: '#ff3df2', cwd: '#24243a', gitBranch: '#00e5ff', node: '#39ff14', go: '#00b3ff', python: '#ffe600',
    docker: '#2f6bff', kubernetes: '#8a5cff', success: '#00ff9c', failure: '#ff2e63',
  })),
} as Record<NativePaletteId, NativePromptTheme>;

/** Theme context that is not part of a palette id: Catppuccin accent and the user's custom theme. */
let activeAccent: CatppuccinAccent = 'mauve';
let activeCustomTheme: CustomTheme | undefined;

/** Set from the live configuration before rendering; previews of the same config see the same context. */
export function setThemeContext(accent: CatppuccinAccent, custom: CustomTheme | undefined): void {
  activeAccent = accent;
  activeCustomTheme = custom;
}

export function themeContext(): {accent: CatppuccinAccent; custom: CustomTheme | undefined} {
  return {accent: activeAccent, custom: activeCustomTheme};
}

function familyTheme(variant: ThemeVariant): NativePromptTheme {
  const rolesFor = () => auto(accentedVariant(variant, activeAccent).roles);
  let cacheKey = '';
  let cached = rolesFor();
  return {id: variant.id as NativePaletteId, label: variant.label, description: variant.description, colors: role => {
    if (cacheKey !== activeAccent) { cacheKey = activeAccent; cached = rolesFor(); }
    return isGitStateRole(role) ? themeGitColors(cached, role) : cached[role];
  }};
}

const FALLBACK_CUSTOM = {project: '#a67cf3', cwd: '#7a68b8', gitBranch: '#5e45a6', node: '#9a6fd6', go: '#5d56c2', python: '#b08bcb',
  docker: '#544ca8', kubernetes: '#6c5fc7', success: '#7c84cf', failure: '#b85c8f'};

let customRolesSource: CustomTheme['prompt'] | undefined;
let customRoles = auto(FALLBACK_CUSTOM);
const CUSTOM_THEME: NativePromptTheme = {id: 'custom', label: 'Custom', description: 'your own NMSh theme', colors: role => {
  const source = activeCustomTheme?.prompt;
  if (source !== customRolesSource) { customRolesSource = source; customRoles = auto(source ?? FALLBACK_CUSTOM); }
  return isGitStateRole(role) ? themeGitColors(customRoles, role) : customRoles[role];
}};

for (const variant of THEME_VARIANTS) (NATIVE_PROMPT_THEMES as Record<string, NativePromptTheme>)[variant.id] = familyTheme(variant);
(NATIVE_PROMPT_THEMES as Record<string, NativePromptTheme>).custom = CUSTOM_THEME;

/** The live label for the custom theme includes its name. */
export function themeLabel(palette: NativePaletteId): string {
  return palette === 'custom' && activeCustomTheme ? `Custom · ${activeCustomTheme.name}` : (NATIVE_PROMPT_THEMES[palette] ?? NATIVE_PROMPT_THEMES.lavender).label;
}

function colorFromHex(color: string | undefined, fallback: RgbColor): RgbColor {
  if (!color || !/^#[0-9a-f]{6}$/iu.test(color)) return fallback;
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
  };
}

/** The cwd module's text at one shortening level of the central path policy. */
function cwdText(context: PromptContext, level: number): string {
  return safePromptText(displayPath({cwd: context.cwd, home: context.home ?? homedir(), root: context.root, abbreviations: context.pathAbbreviations}, level));
}

const TOOLCHAIN_LABELS: Record<ToolchainId, string> = {node: 'node', go: 'go', python: 'python', docker: 'docker'};

function withIcon(id: ModuleIconId, text: string, icons: NativeIconMode): string {
  const icon = icons === 'nerd' ? moduleIcon(id) : '';
  return icon ? `${icon} ${text}` : text;
}

/** Nothing staged, modified, untracked, or conflicted, and no merge/rebase/cherry-pick underway. */
export function isCleanWorkingTree(git: NonNullable<PromptContext['git']>): boolean {
  return !git.staged && !git.modified && !git.untracked && !git.conflicts && !git.operation;
}

function moduleSegments(config: ContextModuleConfig, context: PromptContext, icons: NativeIconMode, richGit: boolean, pathLevel: number): Array<{text: string; role: PromptRole; compact?: boolean}> {
  const status = context.exitStatus ?? 0;
  if (!config.visible) return [];
  if (config.condition === 'inRepository' && !context.branch) return [];
  if (config.condition === 'nonzeroExit' && status === 0) return [];
  // Toolchains filter per toolchain below; other on-command modules need a matching command.
  if (config.condition === 'onCommand' && config.id !== 'toolchain' && !isOnCommandRelevant(config.id, context.commandWords ?? [])) return [];
  if (config.condition === 'shellDiffers' && !context.shell?.differs) return [];

  switch (config.id) {
    case 'project': return [{text: safePromptText(context.project), role: 'project'}];
    case 'cwd': return [{text: cwdText(context, pathLevel), role: 'cwd'}];
    case 'gitBranch': {
      if (!context.branch) return [];
      // Rich Git Off keeps the plain branch: no state segments, no dirty mark.
      const git = richGit ? context.git : undefined;
      const dirty = Boolean(git && (git.staged || git.modified || git.untracked || git.conflicts));
      const branchLabel = `${safePromptText(context.branch)}${dirty ? '*' : ''}`;
      return [{text: icons === 'off' ? branchLabel : `${GLYPHS.branch} ${branchLabel}`, role: 'gitBranch'}];
    }
    case 'gitStatus': {
      // Rich Git Off keeps the plain branch: no state segments.
      const git = richGit && context.branch ? context.git : undefined;
      // No status (outside a repo, probe failed or timed out) is unknown, never clean.
      if (!git) return [];
      const segments: Array<{text: string; role: PromptRole; compact?: boolean}> = [];
      // Clean is a marker-sized segment; the prompt geometry gives it its shape.
      if (isCleanWorkingTree(git)) segments.push({text: '', role: 'gitClean', compact: true});
      if (git.staged) segments.push({text: `+${git.staged}`, role: 'gitStaged'});
      if (git.modified) segments.push({text: `~${git.modified}`, role: 'gitModified'});
      if (git.untracked) segments.push({text: `?${git.untracked}`, role: 'gitUntracked'});
      if (git.conflicts) segments.push({text: `!${git.conflicts}`, role: 'gitConflict'});
      if (git.ahead && git.behind) segments.push({text: `↑${git.ahead} ↓${git.behind}`, role: 'gitDiverged'});
      else if (git.ahead) segments.push({text: `↑${git.ahead}`, role: 'gitAhead'});
      else if (git.behind) segments.push({text: `↓${git.behind}`, role: 'gitBehind'});
      if (git.operation) segments.push({text: git.operation, role: 'gitOperation'});
      return segments;
    }
    case 'toolchain': return (context.toolchains ?? [])
      .filter(id => config.condition !== 'onCommand' || matchesCommand(TOOLCHAIN_TRIGGERS[id], context.commandWords))
      .map(id => ({text: withIcon(id, TOOLCHAIN_LABELS[id], icons), role: id}));
    // A namespace other than the default is part of "where commands go"; the context alone stays the familiar form.
    case 'kubeContext': return context.kubeContext ? [{text: withIcon('kubernetes', safePromptText(context.kubeNamespace && context.kubeNamespace !== 'default'
      ? `${context.kubeContext} (${context.kubeNamespace})` : context.kubeContext), icons), role: 'kubernetes'}] : [];
    // The managed backend uses the environment-context color (as the Kubernetes context does), so every theme colors it.
    case 'shell': return context.shell ? [{text: withIcon('shell', safePromptText(context.shell.current), icons), role: 'kubernetes'}] : [];
    case 'discoveredTools': {
      const count = context.discovery?.executables.length ?? 0;
      return count ? [{text: `${count} local tools`, role: 'project'}] : [];
    }
    case 'dockerContext': return context.dockerContext ? [{text: withIcon('docker', safePromptText(context.dockerContext), icons), role: 'docker'}] : [];
    case 'exitStatus': return [{
      text: `${status === 0 ? GLYPHS.success : GLYPHS.failure} ${status}`,
      role: status === 0 ? 'success' : 'failure',
    }];
    default: return [];
  }
}

/** A pack module's segments: visibility conditions here, presentation in the shared declarative renderer. */
function packModuleSegments(config: ContextModuleConfig, context: PromptContext, facts: ReturnType<typeof promptFacts>, icons: NativeIconMode,
  purpose: 'display' | 'snapshot'): Array<{text: string; role: PromptRole; compact?: boolean}> {
  const definition = moduleDefinition(config.id);
  if (!definition?.pack || !config.visible) return [];
  if (config.condition === 'inRepository' && !context.branch) return [];
  if (config.condition === 'onCommand' && !matchesCommand(definition.triggers ?? [], context.commandWords)) return [];
  return declarativeSegments(definition, facts, {icons, glyphs: getCurrentGlyphMode(), now: context.now ?? presentationNow().getTime(), purpose});
}

/** Whether an on-command module is relevant to the command words being typed. */
export function isOnCommandRelevant(id: ContextModuleConfig['id'], words: readonly string[]): boolean {
  return moduleRelevantToCommand(id, words);
}

/**
 * Rich Git's geometry as generic block metadata: unset fields inherit the
 * Main Prompt, so the renderer never needs to know what Git is.
 */
export function richGitGeometry(nmsh: PromptConfiguration['nmsh']): {geometry?: PowerlineShape; fade?: PowerlineShape | 'off'} {
  const geometry = nmsh.gitGeometry === 'follow' ? undefined : nmsh.gitGeometry;
  const connector = geometry ?? nmsh.connector;
  // Follow main prompt inherits the Main Prompt fade *mode*: "Follow connector"
  // then means Rich Git's own connector, so a geometry override stays visible.
  const main = nmsh.connectorFade === 'follow' ? connector : nmsh.connectorFade;
  const fade = nmsh.gitConnectorFade === 'followMain' ? main
    : nmsh.gitConnectorFade === 'followGeometry' ? connector
      : nmsh.gitConnectorFade;
  return {...(geometry ? {geometry} : {}), fade};
}

const IDENTITY_ROLES: ReadonlySet<PromptRole> = new Set(['project', 'cwd', 'node', 'go', 'python', 'docker']);

/**
 * Semantic colors: Preserve keeps success, failure and Rich Git state fills;
 * Override lets Chroma recolor them, because their text and symbols (✔ 0,
 * +2, ~1, ↑3) still say what they mean and text contrast is corrected after
 * Chroma. The textless clean-tree marker is meaning by color alone, so it is
 * always kept. Identity scope treats project, path and toolchains; Whole
 * prompt also treats the branch and context modules.
 */
export function chromaEligibleRole(role: PromptRole, scope: 'identity' | 'prompt', semantic: 'preserve' | 'override' = 'preserve'): boolean {
  if (role === 'gitClean') return false;
  if (role === 'success' || role === 'failure' || isGitStateRole(role)) return semantic === 'override';
  return scope === 'prompt' || IDENTITY_ROLES.has(role);
}

/** Theme colors after vibrance, with text re-chosen when the fill moved. Semantic Git colors are not theme colors. */
export function vibrantRoleColors(role: PromptRole, palette: NativePaletteId, gitColors: GitColorMode, vibrance: Vibrance): SegmentColors {
  const colors = promptRoleColors(role, palette, gitColors);
  if (vibrance === 'standard' || (isGitStateRole(role) && gitColors !== 'followTheme')) return colors;
  const fill = applyVibrance(colors.background, vibrance);
  return {background: fill, foreground: readableForeground(fill, colors.foreground)};
}

const THEME_STOP_ROLES: readonly PromptRole[] = ['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker', 'kubernetes'];

/**
 * Current Theme Chroma stops from the actual Native theme (after vibrance):
 * the theme's own module fills in prompt order, lightness held in a band
 * and chroma kept up so the sweep stays recognizably that theme instead of
 * washing toward white. Near-duplicate hues collapse.
 */
export function themeChromaStops(palette: NativePaletteId, vibrance: Vibrance = 'standard'): RgbColor[] {
  const stops: RgbColor[] = [];
  const hues: number[] = [];
  for (const role of THEME_STOP_ROLES) {
    const lch = toOklch(vibrantRoleColors(role, palette, 'semantic', vibrance).background);
    const neutral = lch.c < 0.03;
    if (!neutral && hues.some(hue => Math.min(Math.abs(hue - lch.h), 360 - Math.abs(hue - lch.h)) < 18)) continue;
    if (!neutral) hues.push(lch.h);
    stops.push(fromOklch({l: Math.max(0.5, Math.min(0.74, lch.l)), c: neutral ? lch.c : Math.max(0.09, lch.c), h: lch.h}));
    if (stops.length >= 5) break;
  }
  return stops;
}

/** The Chroma a live render uses at `time`; undefined when Off. */
export function promptChroma(configuration: PromptConfiguration, time = 0): PromptChroma | undefined {
  const presentation = configuration.presentation;
  const found = treatmentFor(presentation, themeChromaStops(configuration.nmsh.palette, configuration.nmsh.vibrance));
  if (!found) return undefined;
  const treatment = presentation.preset === 'theme' ? {...found, own: true} : found;
  const still = !treatmentAnimated(presentation) || isReducedMotion();
  return {treatment, time: still ? 0 : time, still};
}

/** Render options for a live Native prompt: the selected style's profiles and its Chroma. */
export function promptRenderExtras(configuration: PromptConfiguration, time = 0): RenderExtras {
  return {profiles: configuration.nmsh.styleProfiles, chroma: promptChroma(configuration, time)};
}

/** `pathLevel` shortens the cwd module (see PATH_DISPLAY_LEVELS); 0 is the full, width-independent form. */
export function renderedModules(context: PromptContext, configuration: PromptConfiguration, pathLevel = 0,
  surface: 'prompt' | 'contextRail' = 'prompt', purpose: 'display' | 'snapshot' = 'display'): RenderedModule[] {
  const facts = promptFacts(context);
  const eligible = configuration.modules.filter(module => {
    const definition = moduleDefinition(module.id);
    if (!definition) return false;
    // Built-in modules need their primary legacy fact; pack modules apply fact and field policy per part.
    if (!definition.pack) {
      const primary = facts[definition.fields[0]!];
      if (!primary || !factAllowed(primary, purpose)) return false;
    }
    const target = routeModule(module);
    return surface === 'contextRail' ? target === 'contextRail' : target === 'mainPrompt' || target === 'rightContext';
  }).flatMap(module => {
    const definition = moduleDefinition(module.id)!;
    const segments = definition.pack ? packModuleSegments(module, context, facts, configuration.nmsh.icons, purpose)
      : moduleSegments(module, moduleFactContext(context, facts, definition.fields, purpose), configuration.nmsh.icons, configuration.nmsh.gitEnabled, pathLevel);
    return segments.map(segment => ({...segment, module}));
  });

  // The project block owns the brighter live identity when both location
  // modules say the same thing (notably "~" at HOME).
  const project = eligible.find(segment => segment.role === 'project');
  const visible = eligible.filter(segment => !(segment.role === 'cwd' && project?.text === segment.text));
  const richGit = richGitGeometry(configuration.nmsh);
  const presentation = configuration.presentation;
  return visible.map(segment => {
    // Order of operations: semantic theme → vibrance → explicit module colors.
    // Chroma, contrast correction and capability degradation happen at render.
    const colors = vibrantRoleColors(segment.role, configuration.nmsh.palette, configuration.nmsh.gitColors, configuration.nmsh.vibrance);
    // Per-module custom colors are for the module's identity, not its Git states.
    const custom = !isGitStateRole(segment.role);
    const explicit = custom && Boolean(segment.module.foreground || segment.module.background);
    const chroma = configuration.provider === 'nmsh' && presentation.preset !== 'off' && chromaEligibleRole(segment.role, presentation.scope ?? 'prompt', presentation.semantic ?? 'preserve')
      && (!explicit || presentation.customColors === true);
    const fill = custom ? colorFromHex(segment.module.background, colors.background) : colors.background;
    // Text colors Neutral: the fill, connectors and accent stay the theme's; ordinary text is a stable neutral chosen from the fill.
    // An explicit per-module text color is the person's own choice and is kept.
    const neutral = configuration.nmsh.textColors === 'neutral' && !(custom && segment.module.foreground);
    return {
      ...(configuration.nmsh.style !== 'powerline' ? {style: configuration.nmsh.style} : {}),
      ...(chroma ? {treatment: presentation} : {}),
      id: segment.module.id,
      role: segment.role,
      text: safeContextText(segment.text),
      foreground: neutral ? neutralPromptText(fill) : custom ? colorFromHex(segment.module.foreground, colors.foreground) : colors.foreground,
      background: fill,
      ...(neutral ? {neutralText: true} : {}),
      ...(segment.compact ? {compact: true} : {}),
      ...(isGitStateRole(segment.role) ? richGit : {}),
      ...(routeModule(segment.module) === 'rightContext' ? {placement: 'right' as const} : {}),
    };
  });
}

export function nativePromptSnapshot(context: PromptContext, configuration: PromptConfiguration): PromptSnapshot {
  const modules = renderedModules(context, configuration, 0, 'prompt', 'snapshot');
  const snapshotContext = moduleFactContext(context, promptFacts(context), ['cwd', 'branch'], 'snapshot');
  const segments: PromptSegmentSnapshot[] = modules.map(module => ({
    text: module.text,
    role: module.role,
    foreground: module.foreground,
    background: module.background,
    geometry: 'powerline',
    ...(module.compact ? {compact: true} : {}),
    ...(module.geometry ? {shape: module.geometry} : {}),
    ...(module.fade ? {fade: module.fade} : {}),
    ...(module.placement ? {placement: module.placement} : {}),
  }));
  return {
    provider: 'nmsh',
    layout: configuration.composerLayout,
    segments,
    ...(configuration.nmsh.style !== 'powerline' ? {style: configuration.nmsh.style,
      styleProfile: structuredClone(configuration.nmsh.styleProfiles[configuration.nmsh.style])} : {}),
    endStyle: configuration.nmsh.endStyle,
    startStyle: configuration.nmsh.startStyle,
    connector: configuration.nmsh.connector,
    connectorFade: configuration.nmsh.connectorFade,
    connectorFadeColors: resolveFadeColors(configuration.nmsh.connectorFadeColors, configuration.nmsh.gapEnabled, configuration.gap),
    palette: configuration.nmsh.palette,
    gitColors: configuration.nmsh.gitColors,
    gitEnabled: configuration.nmsh.gitEnabled,
    gitGeometry: configuration.nmsh.gitGeometry,
    gitConnectorFade: configuration.nmsh.gitConnectorFade,
    ...(modules.some(module => module.placement === 'right') ? {mirrorRight: configuration.nmsh.mirrorRight} : {}),
    gap: configuration.nmsh.gapEnabled ? configuration.gap : 0,
    gapEnabled: configuration.nmsh.gapEnabled,
    spacing: configuration.spacing,
    cwd: snapshotContext.cwd,
    ...(snapshotContext.branch ? {branch: safeContextText(snapshotContext.branch)} : {}),
  };
}

/** The live prompt split into its left prompt and right-aligned context, fitted to one row. */
export interface ContextRowParts {
  left: string;
  right: string;
}

/**
 * Fit one prompt row: the left prompt takes what it needs first, then the
 * right context gets what remains after a one-cell minimum gap, or drops.
 */
export function fitContextRow(modules: readonly RenderedModule[], width: number, configuration: PromptConfiguration, time = 0): ContextRowParts {
  const nmsh = configuration.nmsh;
  const extras = promptRenderExtras(configuration, time);
  const gap = nmsh.gapEnabled ? configuration.gap : 0;
  const fade = resolveConnectorFade(nmsh.connectorFade, nmsh.connector);
  const leftBlocks = modules.filter(module => module.placement !== 'right');
  const rightBlocks = modules.filter(module => module.placement === 'right');
  const left = fitPowerlineBlocks(leftBlocks, gap, configuration.spacing, width, nmsh.endStyle, nmsh.gapEnabled,
    nmsh.startStyle, nmsh.connector, fade, nmsh.connectorFadeColors, extras);
  const remaining = width - displayWidth(left) - (left ? 1 : 0);
  const right = rightBlocks.length === 0 || remaining < 3 ? '' : fitRightPowerlineBlocks(rightBlocks, remaining,
    blocks => renderPowerlineBlocks(blocks, gap, configuration.spacing, nmsh.endStyle, nmsh.gapEnabled, nmsh.startStyle, nmsh.connector,
      fade, nmsh.connectorFadeColors, nmsh.mirrorRight ? 'mirrored' : 'normal', extras));
  return {left, right};
}

/** Resolved Native surface parts for composition; no facts are collected here. */
export function buildContextParts(context: PromptContext, width: number, configuration: PromptConfiguration, time = 0): ContextRowParts {
  return fitContextRow(fittedModules(context, configuration, width), width, configuration, time);
}

/** Right-aligned context alone, for rows whose left side is the editor (one-line composer). */
export function buildRightContext(context: PromptContext, width: number, configuration: PromptConfiguration, time = 0): string {
  if (width <= 0) return '';
  const modules = renderedModules(context, configuration).filter(module => module.placement === 'right');
  return modules.length === 0 ? '' : fitContextRow(modules, width, configuration, time).right;
}

/**
 * The least-shortened modules whose full prompt fits: the path shortens
 * before any module is dropped, and only when the width requires it.
 */
function fittedModules(context: PromptContext, configuration: PromptConfiguration, width: number): RenderedModule[] {
  const nmsh = configuration.nmsh;
  let modules = renderedModules(context, configuration);
  const cwd = modules.find(module => module.role === 'cwd');
  if (!cwd) return modules;
  // Widths never depend on Chroma, so fitting measures the plain style.
  const extras: RenderExtras = {profiles: nmsh.styleProfiles};
  const render = (blocks: readonly RenderedModule[], mirrored = false) => blocks.length === 0 ? 0 : displayWidth(renderPowerlineBlocks(blocks,
    nmsh.gapEnabled ? configuration.gap : 0, configuration.spacing, nmsh.endStyle, nmsh.gapEnabled, nmsh.startStyle, nmsh.connector,
    resolveConnectorFade(nmsh.connectorFade, nmsh.connector), nmsh.connectorFadeColors, mirrored ? 'mirrored' : 'normal', extras));
  for (let level = 0; level < PATH_DISPLAY_LEVELS; level += 1) {
    if (level > 0) modules = renderedModules(context, configuration, level);
    const left = render(modules.filter(module => module.placement !== 'right'));
    // A left path decides by the left prompt alone, so right context drops
    // before it shortens; a right path shortens to keep the right area whole.
    const right = cwd.placement === 'right' ? render(modules.filter(module => module.placement === 'right'), nmsh.mirrorRight) : 0;
    if (left + (right ? right + (left ? 1 : 0) : 0) <= width) return modules;
  }
  return modules;
}

export function buildContextLine(
  context: PromptContext,
  width: number,
  configuration: PromptConfiguration,
  placement: 'header' | 'composer' = configuration.placement,
  /** Presentation time for animated Chroma; the static treatment ignores it. */
  time = 0,
): string {
  if (width <= 0) return '';
  // The divider fill is a composer divider line: the same source as the composer rules.
  const divider = (cells: number) => `${paintDivider(repeatToWidth(GLYPHS.separator, cells), configuration.presentation, time)}${RESET}`;
  if (width < 8) return divider(width);

  const modules = renderedModules(context, configuration);
  if (modules.length === 0) {
    return placement === 'header' ? divider(width) : '';
  }

  const {left, right} = fitContextRow(fittedModules(context, configuration, width), width, configuration, time);
  const rightPart = right ? ` ${right}${RESET}` : '';
  const fillWidth = Math.max(0, width - displayWidth(left) - displayWidth(rightPart));
  if (placement === 'composer') return rightPart ? `${left}${RESET}${' '.repeat(fillWidth)}${rightPart}` : `${left}${RESET}`;
  return `${left}${RESET}${divider(fillWidth)}${rightPart}`;
}

/** Resolve appearance through the existing semantic theme context, restoring it after a chosen-theme render. */
export function buildContextRail(context: PromptContext, width: number, configuration: PromptConfiguration, time = 0): string[] {
  const rail = configuration.contextRail;
  if (configuration.provider !== 'nmsh' || rail.mode === 'off') return [];
  const saved = themeContext();
  const chosen = rail.theme === 'choose' ? findTheme(configuration.themes, rail.themeId)?.theme : undefined;
  const draft: PromptConfiguration = {...configuration, nmsh: {...configuration.nmsh,
    ...(rail.theme === 'choose' ? {palette: rail.palette ?? 'lavender'} : {}),
    ...(rail.style !== 'followMain' ? {style: rail.style} : {})}};
  if (rail.theme === 'choose') setThemeContext(draft.nmsh.accent, chosen ?? configuration.customTheme);
  try {
    const modules = renderedModules(context, draft, 0, 'contextRail');
    if (!modules.length) return rail.mode === 'always' ? Array<string>(rail.rows).fill('') : [];
    const groups = configuration.modules.map(module => modules.filter(segment => segment.id === module.id))
      .filter(group => group.length).sort((a, b) => (moduleDefinition(b[0]!.id)?.priority ?? 0) - (moduleDefinition(a[0]!.id)?.priority ?? 0));
    const rows: RenderedModule[][] = Array.from({length: rail.rows}, () => []);
    const compact = Array<boolean>(rail.rows).fill(false);
    const nmsh = draft.nmsh;
    const mirrored = rail.direction === 'mirrored';
    const paintPhysical = (blocks: readonly PowerlineBlock[], tight: boolean) => renderPowerlineBlocks(blocks, tight ? 0 : nmsh.gapEnabled ? draft.gap : 0,
      tight ? 0 : draft.spacing, nmsh.endStyle, tight ? false : nmsh.gapEnabled, nmsh.startStyle, nmsh.connector,
      resolveConnectorFade(nmsh.connectorFade, nmsh.connector), nmsh.connectorFadeColors, mirrored ? 'mirrored' : 'normal', promptRenderExtras(draft, time));
    const paint = (blocks: RenderedModule[], tight: boolean) => paintPhysical(mirrored ? [...blocks].reverse() : blocks, tight);
    for (const group of groups) {
      let placed = false;
      for (let index = 0; index < rows.length; index += 1) {
        const candidate = [...rows[index]!, ...group];
        if (displayWidth(paint(candidate, compact[index]!)) <= width) { rows[index] = candidate; placed = true; break; }
      }
      if (!placed) for (let index = 0; index < rows.length; index += 1) {
        const candidate = [...rows[index]!, ...group];
        if (displayWidth(paint(candidate, true)) <= width) { rows[index] = candidate; compact[index] = true; placed = true; break; }
      }
      // Preserve the highest priority group even when its full text cannot fit.
      if (!placed && rows.every(row => !row.length)) {
        rows[0] = group;
        compact[0] = true;
      }
    }
    const paintedRows = rows.map((blocks, index) => {
      if (!blocks.length || width <= 0) return '';
      const painted = paint(blocks, compact[index]!);
      if (displayWidth(painted) <= width) return painted;
      if (mirrored) return fitRightPowerlineBlocks([...blocks].reverse(), width, fitted => paintPhysical(fitted, true));
      return fitPowerlineBlocks(blocks, 0, 0, width, nmsh.endStyle, false,
        nmsh.startStyle, nmsh.connector, resolveConnectorFade('off', nmsh.connector), nmsh.connectorFadeColors, promptRenderExtras(draft, time));
    });
    return colorLevel() === 'none' ? paintedRows.map(stripAnsi) : paintedRows;
  } finally {
    if (rail.theme === 'choose') setThemeContext(saved.accent, saved.custom);
  }
}

/**
 * Preview-only context: every module type, independent of the real cwd.
 * Never used for the live prompt, which shows only detected modules.
 */
export function themePreviewContext(home = homedir()): PromptContext {
  return {
    cwd: `${home.replace(/\/$/u, '')}/src`,
    project: 'notMyShell',
    branch: 'main',
    // Synthetic Rich Git state so theme rows show it; never probed from a real repo.
    git: {staged: 2, modified: 1, untracked: 3, conflicts: 0, ahead: 2, behind: 0},
    toolchains: ['node', 'go', 'python', 'docker'],
    exitStatus: 0,
  };
}

/**
 * Preview-only context for the module showcase: every module type with a
 * representative value, independent of the real cwd, repository, tools, and
 * typed command. Built from literals only; nothing is probed or executed.
 */
export function moduleShowcaseContext(home = homedir()): PromptContext {
  const root = `${home.replace(/\/$/u, '')}/Projects/notMyShell`;
  return {
    cwd: `${root}/src`,
    project: 'notMyShell',
    root,
    branch: 'feature/example',
    git: {staged: 2, modified: 1, untracked: 0, conflicts: 0, ahead: 1, behind: 0},
    toolchains: ['node'],
    exitStatus: 1,
    // Show-on-command modules appear as if their commands were being typed.
    commandWords: ['kubectl', 'docker', 'npm'],
    kubeContext: 'dev-cluster',
    dockerContext: 'colima',
    shell: {current: 'fish', differs: true},
  };
}

/** Representative Rich Git states for the /prompt Rich Git showcase. Preview-only. */
const NO_GIT_STATE = {staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0};
export const RICH_GIT_SHOWCASE: ReadonlyArray<{label: string; git: NonNullable<PromptContext['git']>}> = [
  {label: 'Clean', git: NO_GIT_STATE},
  {label: 'Staged', git: {...NO_GIT_STATE, staged: 2}},
  {label: 'Modified', git: {...NO_GIT_STATE, modified: 1}},
  {label: 'Untracked', git: {...NO_GIT_STATE, untracked: 3}},
  {label: 'Ahead', git: {...NO_GIT_STATE, ahead: 2}},
  {label: 'Behind', git: {...NO_GIT_STATE, behind: 1}},
  {label: 'Diverged', git: {...NO_GIT_STATE, ahead: 2, behind: 1}},
  {label: 'Conflict', git: {...NO_GIT_STATE, conflicts: 1}},
  {label: 'Operation', git: {...NO_GIT_STATE, modified: 1, operation: 'rebase'}},
];

/** One showcase row: the draft's real geometry and colors over the branch module alone. */
export function buildRichGitShowcaseLine(configuration: PromptConfiguration, git: NonNullable<PromptContext['git']>, width: number): string {
  const preview = structuredClone(configuration);
  preview.modules = DEFAULT_PROMPT_CONFIGURATION.modules.map(module => ({...module, visible: module.id === 'gitBranch' || module.id === 'gitStatus'}));
  return buildContextLine({cwd: '/', project: 'notMyShell', branch: 'main', git}, width, preview, 'composer');
}

/** One theme row for /prompt: real geometry from the draft, synthetic modules, all visible. */
export function buildThemePreviewLine(configuration: PromptConfiguration, palette: NativePaletteId, width: number, time = 0): string {
  const preview = structuredClone(configuration);
  preview.nmsh.palette = palette;
  preview.modules = DEFAULT_PROMPT_CONFIGURATION.modules.map(module => ({...module, visible: true}));
  return buildContextLine(themePreviewContext(), width, preview, 'composer', time);
}

/** Context plus the editable input prompt, sized to leave at least one input cell. */
export function buildInlineContextPrefix(
  context: PromptContext,
  width: number,
  configuration: PromptConfiguration,
  time = 0,
): string {
  if (width <= 0) return '';
  if (width <= displayWidth(GLYPHS.prompt) + 2) return `${foreground(UI_COLORS.accent)}${GLYPHS.prompt}${RESET}`;
  const moduleWidth = Math.max(0, width - displayWidth(`${GLYPHS.prompt} `) - 1);
  // One-line: the prefix is the left prompt; right context sits at the end of the input row.
  const leftOnly = {...configuration, modules: configuration.modules.filter(module => routeModule(module) === 'mainPrompt')};
  const modules = moduleWidth >= 8
    ? buildContextLine(context, moduleWidth, leftOnly, 'composer', time)
    : '';
  return `${modules}${modules ? ' ' : ''}${foreground(UI_COLORS.accent)}${GLYPHS.prompt}${RESET} `;
}

export function buildPromptLine(context: PromptContext, width: number): string {
  return buildContextLine(context, width, DEFAULT_PROMPT_CONFIGURATION, 'header');
}

export function promptContentWidth(context: PromptContext, width: number): number {
  const plain = stripAnsi(buildPromptLine(context, width));
  const separatorIndex = plain.indexOf(GLYPHS.separator);
  return displayWidth(separatorIndex === -1 ? plain : plain.slice(0, separatorIndex));
}
