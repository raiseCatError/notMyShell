import type {Key} from '../terminal/keys.js';
import type {IdleVisualSettings, PromptConfiguration} from '../prompt/configuration.js';
import {IDLE_COLOR_LABELS, IDLE_COLOR_SOURCES, IDLE_TIMEOUTS} from '../prompt/configuration.js';
import {PRESET_STOPS} from '../chroma/treatment.js';
import {hexColor, parseHexColor} from '../chroma/color.js';
import type {Rgb} from '../chroma/escape.js';
import {themeChromaStops} from '../prompt/prompt.js';
import {isDeterministicPresentation} from '../presentation/environment.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {CellGrid} from './CellGrid.js';
import {captureFromRows, type ScreenCapture} from './screenCapture.js';
import {
  HIGH_MOTION, IDLE_FRAME_MS, IDLE_MODE_LABELS, IDLE_MODE_NOTES, IDLE_MODES, idlePalette, randomCandidates, reducedMotionScene, renderScene,
  SCREEN_MODE_EFFECT, type IdleMode, type IdlePalette,
} from './scenes.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
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
 * Follow Chroma / Theme: the active Chroma palette when Chroma is on,
 * otherwise the current theme's own colors. Theme only always uses the
 * theme. Custom uses the idle visuals' own stops.
 */
export function idleStops(configuration: PromptConfiguration, source = configuration.idleVisuals.colorSource): Rgb[] {
  const presentation = configuration.presentation;
  const theme = () => themeChromaStops(configuration.nmsh.palette, configuration.nmsh.vibrance);
  if (source === 'custom') {
    const custom = configuration.idleVisuals.customStops.map(hex => parseHexColor(hex)).filter((color): color is Rgb => Boolean(color));
    if (custom.length) return custom;
  }
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
  /** The captured visible screen, for screen-saver modes. */
  capture?: ScreenCapture;
}

/** One frame as terminal rows, through the shared grid. */
export function idleFrameRows(grid: CellGrid, input: IdleFrameInput): string[] {
  grid.resize(input.width, input.height);
  renderScene(input.mode, grid, {time: input.time, seed: IDLE_SEED, palette: input.palette, level: input.level, nerd: input.nerd, ...(input.capture ? {capture: input.capture} : {})});
  return grid.toRows(input.level);
}

/**
 * What an NMSh session looks like, for previewing a screen saver that animates the screen (Black Hole, Fireworks,
 * Circletastic, raiseCatError) where no screen of the person's is captured (Setup, the color editor). Fixed text: the
 * preview never captures the Setup panel or anything private.
 */
const SAMPLE_SCREEN = [
  '\u001b[38;2;197;185;232m❯\u001b[0m npm test',
  '  \u001b[38;2;116;181;154m✔\u001b[0m 42 passing \u001b[38;2;125;133;144m(1.2s)\u001b[0m',
  '\u001b[38;2;197;185;232m❯\u001b[0m git status --short',
  ' \u001b[38;2;205;115;123mM\u001b[0m src/app/TerminalApp.ts',
  '\u001b[38;2;125;133;144m??\u001b[0m notes/ideas.md',
  '\u001b[38;2;197;185;232m❯\u001b[0m make build',
  '\u001b[38;2;205;115;123merror:\u001b[0m expected \';\' at main.c:12',
  '\u001b[38;2;197;185;232m❯\u001b[0m ls',
  'README.md  package.json  src  tests',
];

export function sampleCapture(width: number, height: number): ScreenCapture {
  return captureFromRows(SAMPLE_SCREEN, width, height, IDLE_SEED);
}

/** How long Random's preview shows each saver it can pick before the next. */
export const RANDOM_PREVIEW_DWELL_MS = 6000;

/**
 * The saver a preview shows for a mode at `elapsed`: the mode itself, or for Random each of the savers Random can
 * actually choose (the registry's own candidates), in turn, with the time into that one.
 */
export function previewSaver(mode: IdleMode, elapsed: number): {mode: IdleMode; elapsed: number} {
  if (mode !== 'random') return {mode, elapsed};
  const candidates = randomCandidates().filter((id): id is IdleMode => (IDLE_MODES as readonly string[]).includes(id));
  if (!candidates.length) return {mode: 'deepSpace', elapsed};
  return {mode: candidates[Math.floor(elapsed / RANDOM_PREVIEW_DWELL_MS) % candidates.length]!, elapsed: elapsed % RANDOM_PREVIEW_DWELL_MS};
}

/**
 * One preview frame of a screen saver, as the real renderer draws it: screen effects run over `capture` (the
 * gallery's snapshot of the real screen) or over the sample screen. `sample` keeps the sample capture between
 * frames (a screen effect keeps its own state per capture) and restarts it when the saver or size changes.
 */
export function idlePreviewRows(grid: CellGrid, input: Omit<IdleFrameInput, 'time' | 'capture'> & {elapsed: number; still: boolean; capture?: ScreenCapture;
  sample: {key?: string; capture?: ScreenCapture}}): {rows: string[]; shown: IdleMode} {
  const {mode, elapsed} = previewSaver(input.mode, input.elapsed);
  let capture = SCREEN_MODE_EFFECT[mode] ? input.capture : undefined;
  if (SCREEN_MODE_EFFECT[mode] && !capture) {
    const key = `${mode}|${input.width}x${input.height}|${input.mode === 'random' ? Math.floor(input.elapsed / RANDOM_PREVIEW_DWELL_MS) : 0}`;
    if (input.sample.key !== key || !input.sample.capture) { input.sample.key = key; input.sample.capture = sampleCapture(input.width, input.height); }
    capture = input.sample.capture;
  }
  const time = input.still ? 20_000 : sceneTime(elapsed, Math.floor(elapsed / IDLE_FRAME_MS[mode]), mode);
  return {rows: idleFrameRows(grid, {mode, width: input.width, height: input.height, time, palette: input.palette, level: input.level, nerd: input.nerd, ...(capture ? {capture} : {})}), shown: mode};
}

// ---- /screensaver gallery --------------------------------------------------------

type GalleryRow = 'mode' | 'color' | 'timeout' | 'preview';
const ROWS: readonly GalleryRow[] = ['mode', 'color', 'timeout', 'preview'];

export interface ScreensaverPanelState {selected: number; startedAt: number}

export const SCREENSAVER_MIN_SIZE = {columns: 48, rows: 16} as const;

export function createScreensaverPanel(now: number): ScreensaverPanelState {
  return {selected: 0, startedAt: now};
}

export type ScreensaverAction = {kind: 'close'} | {kind: 'start'} | {kind: 'replay'} | {kind: 'editColors'} | {kind: 'change'; settings: IdleVisualSettings} | undefined;

/** Choosing Custom starts from the colors in effect, so nothing jumps; existing custom stops are kept. */
export function withIdleColorSource(configuration: PromptConfiguration, colorSource: IdleVisualSettings['colorSource']): IdleVisualSettings {
  const settings = configuration.idleVisuals;
  const customStops = colorSource === 'custom' && !settings.customStops.length
    ? idleStops(configuration, 'appearance').slice(0, 8).map(hexColor) : settings.customStops;
  return {...settings, colorSource, customStops: colorSource === 'custom' && customStops.length < 2 ? [...PRESET_STOPS.lavender] : customStops};
}

const cycle = <T>(values: readonly T[], value: T, delta: number): T => values[(values.indexOf(value) + delta + values.length) % values.length]!;

/** ↑↓ rows, ←→ change (saved immediately, like Config rows), Enter on Start preview runs it full screen. */
export function screensaverKey(state: ScreensaverPanelState, key: Key, settings: IdleVisualSettings, configuration?: PromptConfiguration): ScreensaverAction {
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  // Lowercase r restarts the visible preview from a pristine source (the gallery has no free-text field).
  if (key.kind === 'text' && key.value === 'r') return {kind: 'replay'};
  if (key.kind === 'up') state.selected = (state.selected + ROWS.length - 1) % ROWS.length;
  else if (key.kind === 'down') state.selected = (state.selected + 1) % ROWS.length;
  else if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'p')) {
    if (ROWS[state.selected] === 'preview' || key.kind === 'text') return {kind: 'start'};
    if (ROWS[state.selected] === 'color' && settings.colorSource === 'custom') return {kind: 'editColors'};
    state.selected = ROWS.indexOf('preview');
  } else if (key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'left' ? -1 : 1;
    switch (ROWS[state.selected]) {
      case 'mode': return {kind: 'change', settings: {...settings, mode: cycle(IDLE_MODES, settings.mode, delta)}};
      case 'color': {
        const colorSource = cycle(IDLE_COLOR_SOURCES, settings.colorSource, delta);
        return {kind: 'change', settings: configuration ? withIdleColorSource({...configuration, idleVisuals: settings}, colorSource) : {...settings, colorSource}};
      }
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
    return `  ${selected ? `${accent}${GLYPHS.selection}` : ' '} ${focusForeground(selected)}${label.padEnd(14)}${reset}${selected && index < 3 ? `${accent}‹ ${value} ›` : `${secondary}${value}`}${reset}`;
  };
  out.push(row(0, 'Mode', IDLE_MODE_LABELS[settings.mode]));
  out.push(row(1, 'Colors', `${IDLE_COLOR_LABELS[settings.colorSource]}${settings.colorSource === 'custom' ? ' · Enter edits' : ''}`));
  out.push(row(2, 'Start after', timeoutLabel(settings.timeout)));
  out.push(row(3, 'Start preview', 'Enter · any key or mouse stops it'));
  out.push('', `  ${subtle}${IDLE_MODE_NOTES[settings.mode]}${reset}`);
  if (motion.disabled) out.push(`  ${subtle}Decorative effects are Off: idle visuals stay off until they are On again.${reset}`);
  else if (motion.still) out.push(`  ${subtle}Reduced Motion: shown still${HIGH_MOTION.has(settings.mode) ? ' as a calm star field' : ''}.${reset}`);
  if (context.preview.length) out.push('', ...context.preview.map(line => `  ${line}`));
  const replayable = !motion.disabled && !motion.still;
  out.push('', renderControls([['↑↓', 'select'], ['←→', 'change'], ...(replayable ? [['r', 'replay'] as [string, string]] : []), ['Enter', 'preview'], ['Esc', 'close']]));
  return framePanel(out.map(line => truncateAnsi(line, columns)), columns).slice(0, Math.max(1, height));
}

/** Preview size inside the panel: bounded so it stays cheap at any terminal size. */
export function previewSize(columns: number, height: number): {width: number; height: number} {
  return {width: Math.max(10, Math.min(72, columns - 6)), height: Math.max(3, Math.min(12, height - 14))};
}
