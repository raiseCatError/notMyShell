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

const RESET = '\u001B[0m';
const LINE = foreground(UI_COLORS.separator);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

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

function renderedModules(context: PromptContext, configuration: PromptConfiguration): RenderedModule[] {
  const rendered = configuration.modules.flatMap(module => {
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

  // At home the project and cwd modules both reduce to "~" and carry no
  // distinct information. Keep pairs such as Projects + ~/Projects intact.
  const cwd = moduleText({id: 'cwd', visible: true, condition: 'always'}, context);
  return rendered.filter(module => !(module.id === 'project' && module.text === cwd));
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

  const content = placement === 'header'
    ? fitPowerlineBlocks(modules, configuration.gap, configuration.spacing, width, true)
    : fitPowerlineBlocks(modules, configuration.gap, configuration.spacing, width);

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
  const moduleWidth = Math.max(0, width - displayWidth(`${GLYPHS.prompt} `) - 2);
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
