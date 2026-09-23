import {displayWidth, repeatToWidth, stripAnsi, truncateAnsi} from '../util/text.js';
import type {PromptContext} from '../shell/ShellContext.js';
import {background, foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {
  DEFAULT_PROMPT_CONFIGURATION,
  type ContextModuleConfig,
  type PromptConfiguration,
} from './configuration.js';
import {homedir} from 'node:os';

const RESET = '\u001B[0m';
const LINE = foreground(UI_COLORS.separator);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

export const FADE_TAIL_GLYPHS = GLYPHS.powerlineFade;

function safePromptText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, '�');
}

interface RenderedModule {
  text: string;
  foreground: string;
  background: string;
  transitionForeground: string;
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
  return configuration.modules.flatMap(module => {
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
      text,
      foreground: foreground(colorFromHex(module.foreground, fallbackForeground)),
      background: background(moduleBackground),
      transitionForeground: foreground(moduleBackground),
    }];
  });
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

  let content = `${modules[0].foreground}${modules[0].background} ${modules[0].text} `;
  for (let index = 1; index < modules.length; index += 1) {
    const current = modules[index];
    content += modules[index - 1].transitionForeground;
    content += `${current.background}${configuration.separator}`;
    content += `${current.foreground}${current.background}${' '.repeat(configuration.spacing)}${current.text} `;
  }

  if (placement === 'composer') return `${truncateAnsi(content, width)}${RESET}`;

  const tail = `${RESET}${modules[modules.length - 1].transitionForeground}${FADE_TAIL_GLYPHS} `;
  const maximumContentWidth = Math.max(0, width - displayWidth(tail));
  const trimmedContent = truncateAnsi(content, maximumContentWidth);
  const separatorWidth = Math.max(0, width - displayWidth(trimmedContent) - displayWidth(tail));
  return `${trimmedContent}${tail}${LINE}${repeatToWidth('─', separatorWidth)}${RESET}`;
}

export function buildPromptLine(context: PromptContext, width: number): string {
  return buildContextLine(context, width, DEFAULT_PROMPT_CONFIGURATION, 'header');
}

export function promptContentWidth(context: PromptContext, width: number): number {
  const plain = stripAnsi(buildPromptLine(context, width));
  const separatorIndex = plain.indexOf('─');
  return displayWidth(separatorIndex === -1 ? plain : plain.slice(0, separatorIndex));
}
