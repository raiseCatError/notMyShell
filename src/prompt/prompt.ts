import {displayWidth, repeatToWidth, stripAnsi} from '../util/text.js';
import type {PromptContext, ToolchainId} from '../shell/ShellContext.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {
  DEFAULT_PROMPT_CONFIGURATION,
  type ContextModuleConfig,
  type NativePaletteId,
  type PromptConfiguration,
} from './configuration.js';
import {homedir} from 'node:os';
import {fitPowerlineBlocks} from './powerline.js';
import type {PromptSnapshot, PromptSegmentSnapshot} from './snapshot.js';

const RESET = '\u001B[0m';
const LINE = foreground(UI_COLORS.separator);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;
export const NATIVE_LAVENDER_RAMP: readonly RgbColor[] = [
  {red: 166, green: 124, blue: 243},
  {red: 157, green: 115, blue: 231},
  {red: 148, green: 106, blue: 219},
  {red: 139, green: 97, blue: 207},
  {red: 130, green: 88, blue: 195},
  {red: 121, green: 79, blue: 183},
  {red: 112, green: 70, blue: 171},
  {red: 103, green: 61, blue: 159},
];
const NATIVE_FOREGROUND: RgbColor = {red: 249, green: 245, blue: 255};

export function nativePaletteColor(visibleIndex: number): RgbColor {
  const index = ((Math.trunc(visibleIndex) % NATIVE_LAVENDER_RAMP.length) + NATIVE_LAVENDER_RAMP.length) % NATIVE_LAVENDER_RAMP.length;
  return {...NATIVE_LAVENDER_RAMP[index]!};
}

export const FADE_TAIL_GLYPHS = GLYPHS.powerlineFade;

function safePromptText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, '�');
}

interface RenderedModule {
  id: ContextModuleConfig['id'];
  text: string;
  foreground: RgbColor;
  background: RgbColor;
}

/** Semantic identity of one rendered segment; themes color roles, not positions. */
export type PromptRole = 'project' | 'cwd' | 'gitBranch' | ToolchainId | 'success' | 'failure';
type SegmentColors = {foreground: RgbColor; background: RgbColor};

const hex = (value: string): RgbColor => colorFromHex(value, {red: 0, green: 0, blue: 0});
const LIGHT_TEXT = hex('#f5f5f7');
const DARK_TEXT = hex('#1b2412');
const TOOLCHAIN_COLORS: Record<ToolchainId, SegmentColors> = {
  docker: {background: hex('#2f8ee0'), foreground: LIGHT_TEXT},
  node: {background: hex('#5fa04e'), foreground: hex('#0f2410')},
  go: {background: hex('#29aed6'), foreground: hex('#0b2530')},
  python: {background: hex('#f2cf4a'), foreground: hex('#2b240a')},
};
const STATUS_COLORS = {
  success: {background: UI_COLORS.success, foreground: hex('#10231b')},
  failure: {background: UI_COLORS.failure, foreground: LIGHT_TEXT},
} as const;

export interface NativePromptTheme {
  id: NativePaletteId;
  label: string;
  description: string;
  /** Colors one segment from its semantic role and visible position. */
  colors(role: PromptRole, visibleIndex: number): SegmentColors;
}

function roleTheme(project: SegmentColors, cwd: SegmentColors, gitBranch: SegmentColors) {
  return (role: PromptRole): SegmentColors => {
    if (role === 'project') return project;
    if (role === 'cwd') return cwd;
    if (role === 'gitBranch') return gitBranch;
    if (role === 'success' || role === 'failure') return STATUS_COLORS[role];
    return TOOLCHAIN_COLORS[role];
  };
}

export const NATIVE_PROMPT_THEMES: Record<NativePaletteId, NativePromptTheme> = {
  lavender: {
    id: 'lavender',
    label: 'Lavender Native',
    description: 'calm monotone lavender ramp',
    colors: (_role, index) => ({foreground: NATIVE_FOREGROUND, background: nativePaletteColor(index)}),
  },
  semantic: {
    id: 'semantic',
    label: 'Soft Semantic',
    description: 'lime project, muted path, charcoal git, tool colors',
    colors: roleTheme(
      {background: hex('#acfc73'), foreground: DARK_TEXT},
      {background: hex('#5e626c'), foreground: hex('#e2e4e9')},
      {background: hex('#3a3d46'), foreground: LIGHT_TEXT},
    ),
  },
  cool: {
    id: 'cool',
    label: 'Cool First',
    description: 'periwinkle, slate and teal with tool colors',
    colors: roleTheme(
      {background: hex('#6f7fd8'), foreground: LIGHT_TEXT},
      {background: hex('#4a5878'), foreground: hex('#dde3f0')},
      {background: hex('#2f6e6c'), foreground: hex('#e8f8f6')},
    ),
  },
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

function moduleSegments(config: ContextModuleConfig, context: PromptContext): Array<{text: string; role: PromptRole}> {
  const status = context.exitStatus ?? 0;
  if (!config.visible) return [];
  if (config.condition === 'inRepository' && !context.branch) return [];
  if (config.condition === 'nonzeroExit' && status === 0) return [];

  switch (config.id) {
    case 'project': return [{text: safePromptText(context.project), role: 'project'}];
    case 'cwd': return [{text: relativeCwd(context.cwd), role: 'cwd'}];
    case 'gitBranch': return context.branch
      ? [{text: `${GLYPHS.branch} ${safePromptText(context.branch)}`, role: 'gitBranch'}]
      : [];
    case 'toolchain': return (context.toolchains ?? []).map(id => ({text: GLYPHS[id], role: id}));
    case 'exitStatus': return [{
      text: `${status === 0 ? GLYPHS.success : GLYPHS.failure} ${status}`,
      role: status === 0 ? 'success' : 'failure',
    }];
  }
}

export function renderedModules(context: PromptContext, configuration: PromptConfiguration): RenderedModule[] {
  const eligible = configuration.modules.flatMap(module => moduleSegments(module, context)
    .map(segment => ({...segment, module})));

  // The project block owns the brighter live identity when both location
  // modules say the same thing (notably "~" at HOME).
  const project = eligible.find(segment => segment.role === 'project');
  const visible = eligible.filter(segment => !(segment.role === 'cwd' && project?.text === segment.text));
  const theme = NATIVE_PROMPT_THEMES[configuration.nmsh.palette] ?? NATIVE_PROMPT_THEMES.lavender;
  return visible.map((segment, index) => {
    const colors = theme.colors(segment.role, index);
    return {
      id: segment.module.id,
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
  if (width < 8) return `${LINE}${repeatToWidth('─', width)}${RESET}`;

  const modules = renderedModules(context, configuration);
  if (modules.length === 0) {
    return placement === 'header' ? `${LINE}${repeatToWidth('─', width)}${RESET}` : '';
  }

  const lineEndStyle = configuration.nmsh.endStyle;
  const content = fitPowerlineBlocks(modules, configuration.nmsh.gapEnabled ? configuration.gap : 0,
    configuration.spacing, width, lineEndStyle, configuration.nmsh.gapEnabled, configuration.nmsh.startStyle);

  if (placement === 'composer') return `${content}${RESET}`;

  const separatorWidth = Math.max(0, width - displayWidth(content));
  return `${content}${LINE}${repeatToWidth('─', separatorWidth)}${RESET}`;
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
  const separatorIndex = plain.indexOf('─');
  return displayWidth(separatorIndex === -1 ? plain : plain.slice(0, separatorIndex));
}
