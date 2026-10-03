import type {Key} from '../terminal/keys.js';
import type {PromptConfiguration} from '../prompt/configuration.js';
import type {CommandType} from '../shell/SemanticService.js';
import type {ProviderInstall} from '../providers/providers.js';
import {TaskProgress, renderTaskProgress} from '../status/TaskProgress.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {truncateAnsi} from '../util/text.js';
import {suggestibleToolFor, type Tool} from './catalog.js';

/**
 * The lightweight prompt offered when a submitted command's first word is
 * missing in the user's real zsh and exactly names a curated optional tool.
 * Aliases, functions, builtins and PATH executables always win; nothing is
 * fuzzy-matched, and nothing runs or installs without an explicit choice.
 */

export const INSTALL_ACTIONS = ['install', 'run', 'later', 'ignoreTool', 'never'] as const;
export type InstallAction = typeof INSTALL_ACTIONS[number];

export interface InstallPromptState {
  tool: Tool;
  recipe: ProviderInstall;
  /** The exact composer text the user submitted; it is restored, never lost. */
  command: string;
  selected: number;
  task?: TaskProgress;
  /** After an install finishes: a factual result; the command is not run automatically. */
  result?: {ok: boolean; message: string};
}

/** The plain first word of a simple command, or undefined for anything an exact lookup should not touch. */
export function commandWord(command: string): string | undefined {
  const trimmed = command.trimStart();
  if (!trimmed || trimmed.includes('\n')) return undefined;
  const word = /^[^\s;|&()<>]+/u.exec(trimmed)?.[0];
  // Assignments, paths, quoting and expansions are never mapped to packages.
  if (!word || /[=/\\'"$`~*?[\]{}]/u.test(word)) return undefined;
  return word;
}

/** Cheap, synchronous candidate check: only curated, non-ignored tools with suggestions on. */
export function installCandidate(command: string, configuration: Pick<PromptConfiguration, 'installSuggestions' | 'ignoredInstallSuggestions'>): Tool | undefined {
  if (!configuration.installSuggestions) return undefined;
  const word = commandWord(command);
  const tool = word ? suggestibleToolFor(word) : undefined;
  return tool && !configuration.ignoredInstallSuggestions.includes(tool.id) ? tool : undefined;
}

/**
 * Whether to offer the install: the real zsh reported no alias, function,
 * builtin, keyword or executable for the word (`missing`), the frontend's own
 * PATH lookup agrees, and a safe curated recipe exists. An unavailable or
 * uncertain lookup never prompts.
 */
export function shouldOfferInstall(tool: Tool, shellResolution: CommandType | 'missing' | 'unavailable', onFrontendPath: boolean,
  recipe: ProviderInstall | undefined): recipe is ProviderInstall {
  return shellResolution === 'missing' && !onFrontendPath && recipe !== undefined;
}

export function createInstallPrompt(tool: Tool, recipe: ProviderInstall, command: string): InstallPromptState {
  return {tool, recipe, command, selected: 0};
}

const LABELS: Record<InstallAction, (tool: Tool) => string> = {
  install: () => 'Install',
  run: () => 'Run anyway',
  later: () => 'Later',
  ignoreTool: tool => `Don't ask for ${tool.label}`,
  never: () => 'Never suggest installs',
};

/** Arrow keys choose; Enter decides; Esc is Later (the composer text is kept). */
export function installPromptKey(state: InstallPromptState, key: Key): InstallAction | 'close' | undefined {
  if (state.task?.state.status === 'running') return undefined;
  if (state.result) return key.kind === 'escape' || key.kind === 'enter' || key.kind === 'interrupt' ? 'close' : undefined;
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'later';
  if (key.kind === 'left' || key.kind === 'up') state.selected = (state.selected + INSTALL_ACTIONS.length - 1) % INSTALL_ACTIONS.length;
  else if (key.kind === 'right' || key.kind === 'down' || key.kind === 'complete') state.selected = (state.selected + 1) % INSTALL_ACTIONS.length;
  else if (key.kind === 'enter') return INSTALL_ACTIONS[state.selected];
  return undefined;
}

/** Configuration after a "don't ask" choice; everything else is unchanged. */
export function ignoreInstallSuggestion(configuration: PromptConfiguration, action: 'ignoreTool' | 'never', tool: Tool): PromptConfiguration {
  if (action === 'never') return {...configuration, installSuggestions: false};
  return {...configuration, ignoredInstallSuggestions: [...new Set([...configuration.ignoredInstallSuggestions, tool.id])]};
}

export function renderInstallPrompt(state: InstallPromptState, columns: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const word = commandWord(state.command) ?? state.tool.executable ?? state.tool.id;
  const rows = [`  ${primary}\`${word}\` is not installed.${reset}`, ''];
  if (state.task?.state.status === 'running') {
    rows.push(...renderTaskProgress(state.task.state), '', renderControls([['Please wait', 'installation in progress']]));
  } else if (state.result) {
    rows.push(`  ${state.result.ok ? foreground(UI_COLORS.success) : foreground(UI_COLORS.failure)}${state.result.message}${reset}`,
      `  ${subtle}Your command is back in the composer; press Enter there to run it.${reset}`, '',
      renderControls([['Enter', 'close'], ['Esc', 'close']]));
  } else {
    rows.push(`  ${primary}Install ${state.tool.label} now?${reset}`,
      `  ${subtle}Runs${reset}  ${primary}${state.recipe.label}${reset}`,
      `  ${subtle}${state.tool.description} Optional: NMSh works without it.${reset}`, '',
      ...INSTALL_ACTIONS.map((action, index) => index === state.selected
        ? `  ${accent}${GLYPHS.selection} ${primary}${LABELS[action](state.tool)}${reset}`
        : `    ${secondary}${LABELS[action](state.tool)}${reset}`), '',
      renderControls([['↑↓', 'choose'], ['Enter', 'confirm'], ['Esc', 'later']]));
  }
  return framePanel(rows.map(row => truncateAnsi(row, columns)), columns);
}
