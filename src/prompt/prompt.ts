import {displayWidth, repeatToWidth, stripAnsi} from '../util/text.js';
import type {PromptContext, ToolchainId} from '../shell/ShellContext.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {GLYPHS, moduleIcon, type ModuleIconId} from '../ui/glyphs.js';
import {
  DEFAULT_PROMPT_CONFIGURATION,
  type ContextModuleConfig,
  type NativeIconMode,
  type NativePaletteId,
  type PromptConfiguration,
} from './configuration.js';
import {homedir} from 'node:os';
import {fitPowerlineBlocks} from './powerline.js';
import type {PromptSnapshot, PromptSegmentSnapshot} from './snapshot.js';

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
}

/** Semantic identity of one rendered segment; themes color roles, not positions. */
export type PromptRole = 'project' | 'cwd' | 'gitBranch' | ToolchainId | 'success' | 'failure';
type SegmentColors = {foreground: RgbColor; background: RgbColor};

const PROMPT_ROLES: readonly PromptRole[] = ['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker', 'success', 'failure'];
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

function theme(id: NativePaletteId, label: string, description: string, roles: Record<PromptRole, SegmentColors>): NativePromptTheme {
  return {id, label, description, colors: role => roles[role]};
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

function moduleSegments(config: ContextModuleConfig, context: PromptContext, icons: NativeIconMode): Array<{text: string; role: PromptRole}> {
  const status = context.exitStatus ?? 0;
  if (!config.visible) return [];
  if (config.condition === 'inRepository' && !context.branch) return [];
  if (config.condition === 'nonzeroExit' && status === 0) return [];

  switch (config.id) {
    case 'project': return [{text: safePromptText(context.project), role: 'project'}];
    case 'cwd': return [{text: relativeCwd(context.cwd), role: 'cwd'}];
    case 'gitBranch': return context.branch
      ? [{text: icons === 'off' ? safePromptText(context.branch) : `${GLYPHS.branch} ${safePromptText(context.branch)}`, role: 'gitBranch'}]
      : [];
    case 'toolchain': return (context.toolchains ?? []).map(id => ({text: withIcon(id, TOOLCHAIN_LABELS[id], icons), role: id}));
    case 'exitStatus': return [{
      text: `${status === 0 ? GLYPHS.success : GLYPHS.failure} ${status}`,
      role: status === 0 ? 'success' : 'failure',
    }];
  }
}

export function renderedModules(context: PromptContext, configuration: PromptConfiguration): RenderedModule[] {
  const eligible = configuration.modules.flatMap(module => moduleSegments(module, context, configuration.nmsh.icons)
    .map(segment => ({...segment, module})));

  // The project block owns the brighter live identity when both location
  // modules say the same thing (notably "~" at HOME).
  const project = eligible.find(segment => segment.role === 'project');
  const visible = eligible.filter(segment => !(segment.role === 'cwd' && project?.text === segment.text));
  const palette = NATIVE_PROMPT_THEMES[configuration.nmsh.palette] ?? NATIVE_PROMPT_THEMES.lavender;
  return visible.map(segment => {
    const colors = palette.colors(segment.role);
    return {
      id: segment.module.id,
      role: segment.role,
      text: segment.text,
      foreground: colorFromHex(segment.module.foreground, colors.foreground),
      background: colorFromHex(segment.module.background, colors.background),
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
  }));
  return {
    provider: 'nmsh',
    layout: configuration.composerLayout,
    segments,
    endStyle: configuration.nmsh.endStyle,
    startStyle: configuration.nmsh.startStyle,
    connector: configuration.nmsh.connector,
    palette: configuration.nmsh.palette,
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
    configuration.spacing, width, lineEndStyle, configuration.nmsh.gapEnabled, configuration.nmsh.startStyle, configuration.nmsh.connector);

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
    toolchains: ['node', 'go', 'python', 'docker'],
    exitStatus: 0,
  };
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
