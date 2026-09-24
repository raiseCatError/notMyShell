import {displayWidth, repeatToWidth, stripAnsi} from '../util/text.js';
import type {PromptContext, ToolchainId} from '../shell/ShellContext.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {GLYPHS, moduleIcon, type ModuleIconId} from '../ui/glyphs.js';
import {
  DEFAULT_PROMPT_CONFIGURATION,
  type ContextModuleConfig,
  type GitColorMode,
  type NativeIconMode,
  type NativePaletteId,
  type PromptConfiguration,
} from './configuration.js';
import {homedir} from 'node:os';
import {fitPowerlineBlocks, resolveConnectorFade, type PowerlineShape} from './powerline.js';
import {desaturatePromptColor, type PromptSnapshot, type PromptSegmentSnapshot} from './snapshot.js';

const RESET = '\u001B[0m';
const LINE = foreground(UI_COLORS.separator);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;
/** NMSh brand/project lavender. */
export const NMSH_BRAND_LAVENDER: RgbColor = {red: 166, green: 124, blue: 243};

export const FADE_TAIL_GLYPHS = GLYPHS.powerlineFade;

function safePromptText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, '�');
}

interface RenderedModule {
  id: ContextModuleConfig['id'];
  role: PromptRole;
  text: string;
  foreground: RgbColor;
  background: RgbColor;
  compact?: boolean;
  geometry?: PowerlineShape;
  fade?: PowerlineShape | 'off';
}

/** Semantic identity of one rendered segment; themes color roles, not positions. */
/** Rich Git state roles; the branch (`gitBranch`) is identity and follows the theme. */
export const GIT_STATE_ROLES = ['gitClean', 'gitStaged', 'gitModified', 'gitUntracked', 'gitAhead', 'gitBehind',
  'gitDiverged', 'gitConflict', 'gitOperation'] as const;
export type GitStateRole = typeof GIT_STATE_ROLES[number];
/** `gitChanges` is legacy: snapshots from before per-state roles combined + ~ ? into one segment. */
export type PromptRole = 'project' | 'cwd' | 'gitBranch' | GitStateRole | 'gitChanges' | ToolchainId | 'success' | 'failure';
type SegmentColors = {foreground: RgbColor; background: RgbColor};

const PROMPT_ROLES: readonly PromptRole[] = ['project', 'cwd', 'gitBranch', ...GIT_STATE_ROLES, 'gitChanges',
  'node', 'go', 'python', 'docker', 'success', 'failure'];

export function isGitStateRole(role: PromptRole): role is GitStateRole | 'gitChanges' {
  return role === 'gitChanges' || (GIT_STATE_ROLES as readonly string[]).includes(role);
}
export function isPromptRole(value: unknown): value is PromptRole {
  return PROMPT_ROLES.includes(value as PromptRole);
}

const hex = (value: string): RgbColor => colorFromHex(value, {red: 0, green: 0, blue: 0});
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
export const NATIVE_PROMPT_THEMES: Record<NativePaletteId, NativePromptTheme> = {
  lavender: theme('lavender', 'Lavender Native', 'lavender, violet and iris family', {
    project: pair('#a67cf3', '#faf6ff'),
    cwd: pair('#7a68b8', '#f3eeff'),
    gitBranch: pair('#5e45a6', '#f3eeff'),
    node: pair('#9a6fd6', '#faf6ff'),
    go: pair('#5d56c2', '#f5f6ff'),
    python: pair('#b08bcb', '#26173d'),
    docker: pair('#544ca8', '#f2f3ff'),
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
    success: pair('#8e9196', '#111214'),
    failure: pair('#e4e5e7', '#111214'),
  }),
};

function colorFromHex(color: string | undefined, fallback: RgbColor): RgbColor {
  if (!color || !/^#[0-9a-f]{6}$/iu.test(color)) return fallback;
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
  };
}

function relativeCwd(value: string): string {
  const home = homedir().replace(/\/$/u, '');
  const cwd = safePromptText(value);
  return cwd === home ? '~' : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
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

function moduleSegments(config: ContextModuleConfig, context: PromptContext, icons: NativeIconMode, richGit: boolean): Array<{text: string; role: PromptRole; compact?: boolean}> {
  const status = context.exitStatus ?? 0;
  if (!config.visible) return [];
  if (config.condition === 'inRepository' && !context.branch) return [];
  if (config.condition === 'nonzeroExit' && status === 0) return [];

  switch (config.id) {
    case 'project': return [{text: safePromptText(context.project), role: 'project'}];
    case 'cwd': return [{text: relativeCwd(context.cwd), role: 'cwd'}];
    case 'gitBranch': {
      if (!context.branch) return [];
      // Rich Git Off keeps the plain branch: no state segments, no dirty mark.
      const git = richGit ? context.git : undefined;
      const dirty = Boolean(git && (git.staged || git.modified || git.untracked || git.conflicts));
      const branchLabel = `${safePromptText(context.branch)}${dirty ? '*' : ''}`;
      const segments: Array<{text: string; role: PromptRole; compact?: boolean}> = [
        {text: icons === 'off' ? branchLabel : `${GLYPHS.branch} ${branchLabel}`, role: 'gitBranch'},
      ];
      // No status (outside a repo, probe failed or timed out) is unknown, never clean.
      if (!git) return segments;
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
    case 'toolchain': return (context.toolchains ?? []).map(id => ({text: withIcon(id, TOOLCHAIN_LABELS[id], icons), role: id}));
    case 'exitStatus': return [{
      text: `${status === 0 ? GLYPHS.success : GLYPHS.failure} ${status}`,
      role: status === 0 ? 'success' : 'failure',
    }];
  }
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

export function renderedModules(context: PromptContext, configuration: PromptConfiguration): RenderedModule[] {
  const eligible = configuration.modules.flatMap(module => moduleSegments(module, context, configuration.nmsh.icons, configuration.nmsh.gitEnabled)
    .map(segment => ({...segment, module})));

  // The project block owns the brighter live identity when both location
  // modules say the same thing (notably "~" at HOME).
  const project = eligible.find(segment => segment.role === 'project');
  const visible = eligible.filter(segment => !(segment.role === 'cwd' && project?.text === segment.text));
  const richGit = richGitGeometry(configuration.nmsh);
  return visible.map(segment => {
    const colors = promptRoleColors(segment.role, configuration.nmsh.palette, configuration.nmsh.gitColors);
    // Per-module custom colors are for the module's identity, not its Git states.
    const custom = !isGitStateRole(segment.role);
    return {
      id: segment.module.id,
      role: segment.role,
      text: segment.text,
      foreground: custom ? colorFromHex(segment.module.foreground, colors.foreground) : colors.foreground,
      background: custom ? colorFromHex(segment.module.background, colors.background) : colors.background,
      ...(segment.compact ? {compact: true} : {}),
      ...(isGitStateRole(segment.role) ? richGit : {}),
    };
  });
}

export function nativePromptSnapshot(context: PromptContext, configuration: PromptConfiguration): PromptSnapshot {
  const modules = renderedModules(context, configuration);
  const segments: PromptSegmentSnapshot[] = modules.map(module => ({
    text: module.text,
    role: module.role,
    foreground: module.foreground,
    background: module.background,
    geometry: 'powerline',
    ...(module.compact ? {compact: true} : {}),
    ...(module.geometry ? {shape: module.geometry} : {}),
    ...(module.fade ? {fade: module.fade} : {}),
  }));
  return {
    provider: 'nmsh',
    layout: configuration.composerLayout,
    segments,
    endStyle: configuration.nmsh.endStyle,
    startStyle: configuration.nmsh.startStyle,
    connector: configuration.nmsh.connector,
    connectorFade: configuration.nmsh.connectorFade,
    palette: configuration.nmsh.palette,
    gitColors: configuration.nmsh.gitColors,
    gitEnabled: configuration.nmsh.gitEnabled,
    gitGeometry: configuration.nmsh.gitGeometry,
    gitConnectorFade: configuration.nmsh.gitConnectorFade,
    gap: configuration.nmsh.gapEnabled ? configuration.gap : 0,
    gapEnabled: configuration.nmsh.gapEnabled,
    spacing: configuration.spacing,
    cwd: context.cwd,
    ...(context.branch ? {branch: context.branch} : {}),
  };
}

export function buildContextLine(
  context: PromptContext,
  width: number,
  configuration: PromptConfiguration,
  placement: 'header' | 'composer' = configuration.placement,
): string {
  if (width <= 0) return '';
  if (width < 8) return `${LINE}${repeatToWidth(GLYPHS.separator, width)}${RESET}`;

  const modules = renderedModules(context, configuration);
  if (modules.length === 0) {
    return placement === 'header' ? `${LINE}${repeatToWidth(GLYPHS.separator, width)}${RESET}` : '';
  }

  const lineEndStyle = configuration.nmsh.endStyle;
  const content = fitPowerlineBlocks(modules, configuration.nmsh.gapEnabled ? configuration.gap : 0,
    configuration.spacing, width, lineEndStyle, configuration.nmsh.gapEnabled, configuration.nmsh.startStyle, configuration.nmsh.connector,
    resolveConnectorFade(configuration.nmsh.connectorFade, configuration.nmsh.connector));

  if (placement === 'composer') return `${content}${RESET}`;

  const separatorWidth = Math.max(0, width - displayWidth(content));
  return `${content}${LINE}${repeatToWidth(GLYPHS.separator, separatorWidth)}${RESET}`;
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
  preview.modules = DEFAULT_PROMPT_CONFIGURATION.modules.map(module => ({...module, visible: module.id === 'gitBranch'}));
  return buildContextLine({cwd: '/', project: 'notMyShell', branch: 'main', git}, width, preview, 'composer');
}

/** One theme row for /prompt: real geometry from the draft, synthetic modules, all visible. */
export function buildThemePreviewLine(configuration: PromptConfiguration, palette: NativePaletteId, width: number): string {
  const preview = structuredClone(configuration);
  preview.nmsh.palette = palette;
  preview.modules = DEFAULT_PROMPT_CONFIGURATION.modules.map(module => ({...module, visible: true}));
  return buildContextLine(themePreviewContext(), width, preview, 'composer');
}

/** Context plus the editable input prompt, sized to leave at least one input cell. */
export function buildInlineContextPrefix(
  context: PromptContext,
  width: number,
  configuration: PromptConfiguration,
): string {
  if (width <= 0) return '';
  if (width <= displayWidth(GLYPHS.prompt) + 2) return `${foreground(UI_COLORS.accent)}${GLYPHS.prompt}${RESET}`;
  const moduleWidth = Math.max(0, width - displayWidth(`${GLYPHS.prompt} `) - 1);
  const modules = moduleWidth >= 8
    ? buildContextLine(context, moduleWidth, configuration, 'composer')
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
