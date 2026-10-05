import type {CursorSettings} from '../prompt/configuration.js';
import {overlayRow, type CellPaint} from '../presentation/cellOverlay.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import {CursorEngine, seededRandom} from './CursorEngine.js';
import {effectPalette} from './palette.js';
import type {BackendChoice} from './backends.js';

/**
 * The /cursor (and Setup) preview: a fixed-size, finite, replayable
 * demonstration of the SELECTED setting, built from the real pieces.
 *
 *   shape / blink   the synthetic caret drawn in the real shape (Block fills
 *                   the cell, Bar and Underline draw their thin glyphs; Host
 *                   default has no shape of its own and is labelled as such)
 *   idle effect     the caret settles, then the idle effect runs
 *   everything else the CursorEngine, driven through a scripted jump forward
 *                   and back, with the same overlay the composer uses
 *
 * Pure: the frame is a function of (settings, elapsed), so a selection or a
 * value change just restarts the clock, R replays, and the same inputs always
 * give the same frame. After `PREVIEW_END_MS` the last frame is held and no
 * frame clock is needed. It never touches the composer, a transcript or the
 * terminal's real cursor.
 */
export type PreviewScene = 'shape' | 'blink' | 'idle' | 'jump';

/** Title, the rule above the composer, the sample row, a caption and a note: always this many, so the panel never changes height. */
export const PREVIEW_ROWS = 5;
export const PREVIEW_END_MS = 2800;
export const BLINK_PERIOD_MS = 530;
export const BLINK_DEMO_MS = 3200;

const SAMPLE = 'git commit -m "ship it"';
const BASE = 6;
const START = 3;
/** Row 0 is the rule above the composer, as in the real frame (effects may reach one row above the input). */
const SAMPLE_ROW = 1;
const JUMPS: Array<{at: number; column: number}> = [{at: 0, column: START}, {at: 250, column: SAMPLE.length}, {at: 1400, column: START}];

export interface CursorPreviewInput {
  scene: PreviewScene;
  /** The setting being demonstrated, for the title ("Shape: Bar"). */
  title: string;
  /** Draft settings with theme-derived colors already resolved. */
  settings: CursorSettings;
  choice: BackendChoice;
  columns: number;
  /** Milliseconds since the preview was (re)started. */
  elapsed: number;
  /** Decorative motion is not allowed (Reduced Motion, Decorative Effects Off, NO_COLOR): show the settled frame. */
  still: boolean;
  /** Why this scene cannot demonstrate (an unavailable value): the caption says so and nothing animates. */
  unavailable?: string;
}

export interface CursorPreview {
  rows: string[];
  busy: boolean;
  /** The caret cell as painted, for tests and captions. */
  caption: string;
}

/** The synthetic caret in the draft's shape, or the host-default placeholder. */
export function shapePaint(settings: CursorSettings, color: {red: number; green: number; blue: number}, hostAsBlock = false): CellPaint {
  // Host default has no shape NMSh can draw. The shape and blink scenes label it with a placeholder; the others
  // (motion, effects, colors) draw the caret NMSh itself draws while it moves: a block.
  if (settings.shape === 'host') return hostAsBlock ? {caret: true, caretShape: 'block', color} : {glyph: '▯', foreground: UI_COLORS.subtle};
  return {caret: true, caretShape: settings.shape, color};
}

const SHAPE_CAPTION: Record<CursorSettings['shape'], string> = {
  host: 'Host default · your terminal draws its own cursor; NMSh sends no shape (▯ is only a placeholder)',
  block: 'Block · fills the cell',
  bar: 'Bar · a thin line at the cell\'s left edge',
  underline: 'Underline · a line under the cell',
};

function simulate(settings: CursorSettings, scene: PreviewScene, elapsed: number): CursorEngine {
  // The idle demo starts at once instead of waiting out the real dwell time.
  const demo: CursorSettings = scene === 'idle' ? {...settings, advanced: {...settings.advanced, dwellMs: 0}} : settings;
  const engine = new CursorEngine(demo, seededRandom(7));
  const end = Math.min(elapsed, PREVIEW_END_MS);
  const jumps = scene === 'jump' ? JUMPS : [{at: 0, column: SAMPLE.length}];
  let next = 0;
  for (let time = 0; time <= end; time += 16) {
    while (next < jumps.length && jumps[next]!.at <= time) {
      engine.target({row: SAMPLE_ROW, column: BASE + jumps[next]!.column}, time, next === 0 ? 'typing' : 'jump');
      next += 1;
    }
    engine.step(time);
  }
  return engine;
}

export function renderCursorPreview(input: CursorPreviewInput): CursorPreview {
  const {scene, settings, choice, columns, still} = input;
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const primary = foreground(UI_COLORS.primary);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const palette = effectPalette(settings);
  const sample = `    ${accent}${GLYPHS.prompt}${reset} ${primary}${SAMPLE}${reset}`;
  const width = Math.max(10, columns - 2);
  const rule = `    ${subtle}${(GLYPHS.separator || '─').repeat(Math.max(4, Math.min(width - 4, 40)))}${reset}`;
  const elapsed = Math.max(0, input.elapsed);
  const settled = {row: SAMPLE_ROW, column: BASE + SAMPLE.length};
  const caretPaint = shapePaint(settings, palette.caret, scene !== 'shape' && scene !== 'blink');
  let caption = '';
  let note = '';
  let busy = false;
  let paints = new Map<number, CellPaint>();
  let above = new Map<number, CellPaint>();

  if (input.unavailable) {
    paints.set(settled.column, caretPaint);
    caption = `Unavailable · ${input.unavailable}`;
    note = 'Nothing is drawn for this setting with the current renderer.';
  } else if (scene === 'shape') {
    paints.set(settled.column, caretPaint);
    caption = SHAPE_CAPTION[settings.shape];
    note = 'The real cursor is the terminal\'s own; NMSh sets only its shape while it owns the composer.';
  } else if (scene === 'blink') {
    const blinking = settings.shape !== 'host' && settings.blink === 'on' && !still;
    const visible = !blinking || elapsed >= BLINK_DEMO_MS || Math.floor(elapsed / BLINK_PERIOD_MS) % 2 === 0;
    if (visible) paints.set(settled.column, caretPaint);
    busy = blinking && elapsed < BLINK_DEMO_MS;
    caption = settings.shape === 'host' ? 'Host default · your terminal decides whether the cursor blinks'
      : settings.blink === 'host' ? 'Blink as the terminal does by default (steady shown here)'
      : settings.blink === 'on' ? `Blink On · blinks for a moment here${still ? ' (Reduced Motion: steady)' : ''}; your terminal paces the real blink`
      : 'Blink Off · steady';
    note = elapsed >= BLINK_DEMO_MS || !busy ? 'R replays' : 'The demo stops by itself.';
  } else if (still) {
    paints.set(settled.column, caretPaint);
    caption = 'Effects stay still (Reduced Motion, Decorative Effects Off or no color): the settled caret';
    note = 'Turn motion back on to see this setting move.';
  } else {
    const engine = simulate(settings, scene, elapsed);
    const frames = engine.paints(palette, {top: 0, bottom: SAMPLE_ROW, columns: width}, Math.min(elapsed, PREVIEW_END_MS));
    paints = new Map(frames.get(SAMPLE_ROW) ?? new Map<number, CellPaint>());
    above = new Map(frames.get(0) ?? new Map<number, CellPaint>());
    if (!engine.drawsCaret) {
      const column = engine.caretCell?.column ?? settled.column;
      paints.set(column, {...paints.get(column), ...caretPaint});
    }
    busy = elapsed < PREVIEW_END_MS;
    const phase = engine.phase === 'movement' ? 'Movement' : engine.phase === 'settling' ? 'Settling' : 'Resting';
    const cap = (value: string) => `${value[0]!.toUpperCase()}${value.slice(1)}`;
    const handled = [...(choice.nativeHandles.motion ? [cap(settings.motion)] : []), ...(choice.nativeHandles.effect ? [cap(settings.effect)] : [])];
    const portable = choice.portableDraws.motion || choice.portableDraws.effect || choice.portableDraws.idle;
    const source = handled.length && choice.native ? `Portable rendering; ${choice.native.host} also draws its own GPU ${handled.join(' + ')}`
      : portable ? 'Portable renderer' : 'No renderer draws effects with this selection';
    caption = `${busy ? (scene === 'idle' ? 'Idle' : phase) : scene === 'idle' ? 'Idle effect running' : 'Settled'} · ${source}`;
    note = busy ? 'Replays on every change; R replays now.' : 'R replays';
  }

  const row = paints.size ? overlayRow(sample, paints, width) : sample;
  const ruleRow = above.size ? overlayRow(rule, above, width) : rule;
  const rows = [`  ${subtle}Preview · ${input.title}${reset}`, ruleRow, row, `    ${secondary}${caption}${reset}`, `    ${subtle}${note}${reset}`];
  return {rows: rows.map(line => truncateAnsi(line, columns)), busy, caption};
}
