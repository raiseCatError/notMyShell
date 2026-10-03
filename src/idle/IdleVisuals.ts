import type {Key} from '../terminal/keys.js';
import type {IdleVisualSettings, PromptConfiguration} from '../prompt/configuration.js';
import {IDLE_COLOR_SOURCES, IDLE_TIMEOUTS} from '../prompt/configuration.js';
import {PRESET_STOPS} from '../chroma/treatment.js';
import {parseHexColor} from '../chroma/color.js';
import type {Rgb} from '../chroma/escape.js';
import {themeChromaStops} from '../prompt/prompt.js';
import {isDeterministicPresentation} from '../presentation/environment.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {CellGrid} from './CellGrid.js';
import {
  HIGH_MOTION, IDLE_FRAME_MS, IDLE_MODE_LABELS, IDLE_MODE_NOTES, IDLE_MODES, idlePalette, reducedMotionScene, renderScene,
  type IdleMode, type IdlePalette,
} from './scenes.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {truncateAnsi} from '../util/text.js';

/**
 * Idle visuals ("Screensaver"): a presentation-only overlay NMSh draws while
 * it owns the terminal and nothing is happening. It never touches transcript,
 * draft, selection, scroll position or session state; dismissing it repaints
 * the exact presentation underneath.
 */

/** The seed used for every idle scene; deterministic captures also fix time. */
export const IDLE_SEED = 0x4e4d5348;

export function timeoutLabel(minutes: number): string {
  return minutes === 0 ? 'Never' : `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Follow Appearance: the active Chroma palette when Chroma is on, otherwise
 * the current theme's own colors. Current Theme always uses the theme.
 */
export function idleStops(configuration: PromptConfiguration, source = configuration.idleVisuals.colorSource): Rgb[] {
  const presentation = configuration.presentation;
  const theme = () => themeChromaStops(configuration.nmsh.palette, configuration.nmsh.vibrance);
  if (source === 'theme' || presentation.preset === 'off' || presentation.preset === 'theme') return theme();
  const hexes = presentation.preset === 'custom' ? presentation.customStops : PRESET_STOPS[presentation.preset];
  const stops = hexes.map(hex => parseHexColor(hex)).filter((color): color is Rgb => Boolean(color));
  return stops.length ? stops : theme();
}

export function idlePaletteFor(configuration: PromptConfiguration, source?: IdleVisualSettings['colorSource']): IdlePalette {
  return idlePalette(idleStops(configuration, source));
}

/** Reduced Motion holds scenes still (high-motion modes become a still star field); Effects Off disables idle visuals. */
export interface IdleMotion {still: boolean; disabled: boolean}

export function idleMotion(configuration: PromptConfiguration, env: NodeJS.ProcessEnv = process.env): IdleMotion {
  return {still: configuration.presentation.reducedMotion || env.NMSH_REDUCED_MOTION === '1', disabled: configuration.presentation.effectsOff};
}

/** The scene actually drawn for a mode under the motion preference. */
export function effectiveMode(mode: IdleMode, motion: IdleMotion): IdleMode {
  return motion.still ? reducedMotionScene(mode) : mode;
}

/**
 * Scene time. Ordinary runs use elapsed wall time; NMSH_DETERMINISTIC uses
 * the frame count at the mode's cadence plus NMSH_IDLE_START_MS, so demos and
 * tests capture identical frames without monkeypatching clocks.
 */
export function sceneTime(elapsedMs: number, frame: number, mode: IdleMode, env: NodeJS.ProcessEnv = process.env): number {
  if (!isDeterministicPresentation()) return Math.max(0, elapsedMs);
  const start = Number(env.NMSH_IDLE_START_MS ?? 0);
  return (Number.isFinite(start) ? Math.max(0, start) : 0) + frame * IDLE_FRAME_MS[mode];
}

export interface IdleFrameInput {
  mode: IdleMode; width: number; height: number; time: number; palette: IdlePalette; level: ColorLevel; nerd: boolean;
}

/** One frame as terminal rows, through the shared grid. */
export function idleFrameRows(grid: CellGrid, input: IdleFrameInput): string[] {
  grid.resize(input.width, input.height);
  renderScene(input.mode, grid, {time: input.time, seed: IDLE_SEED, palette: input.palette, level: input.level, nerd: input.nerd});
  return grid.toRows(input.level);
}

// ---- /screensaver gallery --------------------------------------------------------

type GalleryRow = 'mode' | 'color' | 'timeout' | 'preview';
const ROWS: readonly GalleryRow[] = ['mode', 'color', 'timeout', 'preview'];

export interface ScreensaverPanelState {selected: number; startedAt: number}

export const SCREENSAVER_MIN_SIZE = {columns: 48, rows: 16} as const;

export function createScreensaverPanel(now: number): ScreensaverPanelState {
  return {selected: 0, startedAt: now};
}

export type ScreensaverAction = {kind: 'close'} | {kind: 'start'} | {kind: 'change'; settings: IdleVisualSettings} | undefined;

const cycle = <T>(values: readonly T[], value: T, delta: number): T => values[(values.indexOf(value) + delta + values.length) % values.length]!;

/** ↑↓ rows, ←→ change (saved immediately, like Config rows), Enter on Start preview runs it full screen. */
export function screensaverKey(state: ScreensaverPanelState, key: Key, settings: IdleVisualSettings): ScreensaverAction {
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up') state.selected = (state.selected + ROWS.length - 1) % ROWS.length;
  else if (key.kind === 'down') state.selected = (state.selected + 1) % ROWS.length;
  else if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'p')) {
    if (ROWS[state.selected] === 'preview' || key.kind === 'text') return {kind: 'start'};
    state.selected = ROWS.indexOf('preview');
  } else if (key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'left' ? -1 : 1;
    switch (ROWS[state.selected]) {
      case 'mode': return {kind: 'change', settings: {...settings, mode: cycle(IDLE_MODES, settings.mode, delta)}};
      case 'color': return {kind: 'change', settings: {...settings, colorSource: cycle(IDLE_COLOR_SOURCES, settings.colorSource, delta)}};
      case 'timeout': return {kind: 'change', settings: {...settings, timeout: cycle(IDLE_TIMEOUTS, settings.timeout, delta)}};
      default: return undefined;
    }
  }
  return undefined;
}

export interface ScreensaverPanelContext {
  settings: IdleVisualSettings;
  motion: IdleMotion;
  /** The real renderer's rows for the selected mode at this moment. */
  preview: readonly string[];
}

export function renderScreensaverPanel(state: ScreensaverPanelState, columns: number, height: number, context: ScreensaverPanelContext): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const {settings, motion} = context;
  const out: string[] = [`  ${primary}Screensaver${reset}  ${subtle}idle visuals inside NMSh only · not an OS screensaver${reset}`, ''];
  const row = (index: number, label: string, value: string) => {
    const selected = state.selected === index;
    return `  ${selected ? `${accent}${GLYPHS.selection}` : ' '} ${selected ? primary : secondary}${label.padEnd(14)}${reset}${selected && index < 3 ? `${accent}‹ ${value} ›` : `${secondary}${value}`}${reset}`;
  };
  out.push(row(0, 'Mode', IDLE_MODE_LABELS[settings.mode]));
  out.push(row(1, 'Colors', settings.colorSource === 'appearance' ? 'Follow Appearance' : 'Current Theme'));
  out.push(row(2, 'Start after', timeoutLabel(settings.timeout)));
  out.push(row(3, 'Start preview', 'Enter · any key or mouse stops it'));
  out.push('', `  ${subtle}${IDLE_MODE_NOTES[settings.mode]}${reset}`);
  if (motion.disabled) out.push(`  ${subtle}Effects Off: idle visuals stay off until Effects are on again.${reset}`);
  else if (motion.still) out.push(`  ${subtle}Reduced Motion: shown still${HIGH_MOTION.has(settings.mode) ? ' as a calm star field' : ''}.${reset}`);
  if (context.preview.length) out.push('', ...context.preview.map(line => `  ${line}`));
  out.push('', renderControls([['↑↓', 'select'], ['←→', 'change'], ['Enter', 'preview'], ['Esc', 'close']]));
  return framePanel(out.map(line => truncateAnsi(line, columns)), columns).slice(0, Math.max(1, height));
}

/** Preview size inside the panel: bounded so it stays cheap at any terminal size. */
export function previewSize(columns: number, height: number): {width: number; height: number} {
  return {width: Math.max(10, Math.min(72, columns - 6)), height: Math.max(3, Math.min(12, height - 14))};
}
