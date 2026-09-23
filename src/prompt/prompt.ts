import {displayWidth, repeatToWidth, stripAnsi} from '../util/text.js';
import type {PromptContext} from '../shell/ShellContext.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {
  DEFAULT_PROMPT_CONFIGURATION,
  type ContextModuleConfig,
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

function colorFromHex(color: string | undefined, fallback: RgbColor): RgbColor {
  if (!color || !/^#[0-9a-f]{6}$/iu.test(color)) return fallback;
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
  };
}

function moduleText(config: ContextModuleConfig, context: PromptContext): string | undefined {
  const status = context.exitStatus ?? 0;
  if (!config.visible) return undefined;
  if (config.condition === 'inRepository' && !context.branch) return undefined;
  if (config.condition === 'nonzeroExit' && status === 0) return undefined;

  switch (config.id) {
    case 'project': return safePromptText(context.project);
    case 'cwd': {
      const home = homedir().replace(/\/$/u, '');
      const cwd = safePromptText(context.cwd);
      return cwd === home ? '~' : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
    }
    case 'gitBranch': return context.branch ? `${GLYPHS.branch} ${safePromptText(context.branch)}` : undefined;
    case 'exitStatus': return `${status === 0 ? GLYPHS.success : GLYPHS.failure} ${status}`;
  }
}

export function renderedModules(context: PromptContext, configuration: PromptConfiguration): RenderedModule[] {
  const eligible = configuration.modules.flatMap(module => {
    const text = moduleText(module, context);
    if (!text) return [];

    const fallbackBackground = module.id === 'project'
      ? UI_COLORS.projectBackground
      : module.id === 'cwd'
        ? UI_COLORS.cwdBackground
        : module.id === 'gitBranch'
          ? UI_COLORS.gitBackground
          : (context.exitStatus ?? 0) === 0 ? UI_COLORS.success : UI_COLORS.failure;
    const moduleBackground = colorFromHex(module.background, fallbackBackground);
    const fallbackForeground = module.id === 'gitBranch' ? UI_COLORS.gitForeground : UI_COLORS.projectForeground;
    return [{
      id: module.id,
      text,
      foreground: colorFromHex(module.foreground, fallbackForeground),
      background: moduleBackground,
    }];
  });

  // The project block owns the brighter live identity when both location
  // modules say the same thing (notably "~" at HOME).
  const project = eligible.find(module => module.id === 'project');
  const visible = eligible.filter(module => !(module.id === 'cwd' && project?.text === module.text));
  return visible.map((module, index) => ({
    ...module,
    foreground: configuration.modules.find(item => item.id === module.id)?.foreground
      ? module.foreground
      : NATIVE_FOREGROUND,
    background: configuration.modules.find(item => item.id === module.id)?.background
      ? module.background
      : nativePaletteColor(index),
  }));
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
    gap: configuration.nmsh.gapEnabled ? configuration.gap : 0,
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
    configuration.spacing, width, lineEndStyle);

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
