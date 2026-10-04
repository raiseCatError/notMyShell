import type {ComposerLayout, ComposerPosition, ContextPlacement} from '../prompt/configuration.js';
import {calculateScreenLayout} from './layout.js';

/**
 * Single source of screen geometry for one frame. Render, mouse hit-testing,
 * scroll/focus viewport math, cursor placement, panel takeover and PTY sizing
 * all consume the same plan, so they cannot disagree about where rows live.
 *
 * Coordinate convention: every `top` and `row` in this module is a ZERO-BASED
 * screen row (row 0 is the terminal's first line). Terminal protocols are
 * one-based; convert only at the boundary with `screenRowFromTerminal` and
 * `terminalRowFromScreen`.
 *
 * The plan owns geometry, never appearance: it says where regions are and how
 * tall they are, and the renderer decides what to paint into them.
 */

export type RegionKind =
  | 'transcript'
  | 'gap'
  | 'jump'
  | 'panel'
  | 'inspector'
  | 'suggestions'
  | 'activity'
  | 'composerBorder'
  | 'prompt'
  | 'input'
  | 'separator'
  /** The optional NMSh status strip: one owned row at the top. */
  | 'status'
  /** Cross-session notices: frontend chrome immediately above the composer, never transcript. */
  | 'notices'
  /** The transcript find bar (query, match count, options); frontend chrome above the composer. */
  | 'find';

export interface Region {
  kind: RegionKind;
  /** Zero-based first screen row. */
  top: number;
  height: number;
}

export interface ScreenPlanInput {
  rows: number;
  /** Total wrapped editor rows before the visible-row cap. */
  inputRows: number;
  /** Suggestion rows the composer would like to show. */
  suggestions: number;
  inspectorRows?: number;
  running: boolean;
  detached: boolean;
  hasOutput: boolean;
  contextPlacement: ContextPlacement;
  hasVisibleContext: boolean;
  composerLayout: ComposerLayout;
  /** Rows of an active full-width panel; undefined when no panel owns the screen. */
  panelRows?: number;
  /** Dock Bottom (default), Dock Top, or Flow. */
  composerPosition?: ComposerPosition;
  /** Where full-width NMSh panels sit: Bottom (default) or Top. Independent of the composer position. */
  panelPosition?: 'bottom' | 'top';
  /** Presented transcript rows; Dock Top and Flow use it to keep what follows next to the newest output. */
  transcriptRows?: number;
  /** Flow while scrolled back: the first transcript row in view (the composer follows the transcript's end). */
  viewStart?: number;
  /** Decorative rule rows around the composer; Off removes them from the geometry (default On). */
  composerDividers?: boolean;
}

export interface ScreenPlan {
  rows: number;
  /** Non-empty regions in top-to-bottom order; together they never exceed `rows`. */
  regions: readonly Region[];
  /** Always present (possibly zero-height) so viewport math never special-cases it. */
  transcript: Region;
  /** Visible editor rows (0 while a panel owns the screen). */
  inputHeight: number;
  suggestionCount: number;
  /** Rows given to the shell PTY: the transcript capacity (the viewport height under Dock Bottom). */
  ptyRows: number;
  /**
   * Height the history viewport resolves and scrolls by. The transcript region's
   * height, except in Flow, where the composer scrolls with the document and
   * the viewport keeps the following capacity so scrolling back never snaps.
   */
  viewportRows: number;
  composerPosition: ComposerPosition;
  panelActive: boolean;
  /** Where the active panel is anchored (meaningful while panelActive). */
  panelPosition: 'bottom' | 'top';
}

export interface RegionHit {
  region: Region;
  /** Zero-based row within the region. */
  localRow: number;
}

export function planScreen(input: ScreenPlanInput): ScreenPlan {
  const rows = Math.max(1, input.rows);
  const top = input.composerPosition === 'top';
  if (input.panelRows !== undefined) {
    // Panel takeover follows the explicit NMSh panel position, never the composer position:
    // Bottom keeps the bottom edge fixed (the top edge moves with height), Top keeps the top edge fixed.
    const panelHeight = Math.min(rows, Math.max(0, input.panelRows));
    const panel: Array<[RegionKind, number]> = [['panel', panelHeight]];
    const transcript: Array<[RegionKind, number]> = [['transcript', rows - panelHeight]];
    const atTop = input.panelPosition === 'top';
    return build(rows, atTop ? [...panel, ...transcript] : [...transcript, ...panel],
      {inputHeight: 0, suggestionCount: 0, panelActive: true, composerPosition: input.composerPosition ?? 'bottom', panelPosition: atTop ? 'top' : 'bottom'});
  }
  const inspectorHeight = Math.min(Math.max(0, input.inspectorRows ?? 0), Math.max(0, rows - 8));
  const layout = calculateScreenLayout(
    rows - inspectorHeight,
    input.inputRows,
    input.suggestions,
    input.running,
    input.detached,
    input.hasOutput,
    input.contextPlacement,
    input.hasVisibleContext,
    input.composerLayout,
    input.composerDividers !== false,
  );
  if (top) {
    // Dock Top: composer, its menus, then a chronological transcript. The transcript
    // region is only as tall as its rows, so jump and activity follow the newest output;
    // the PTY still gets the full capacity so it never resizes as output grows.
    const capacity = layout.outputHeight;
    const shown = input.transcriptRows === undefined ? capacity : Math.min(capacity, Math.max(0, input.transcriptRows));
    const plan = build(rows, [
      ['composerBorder', Number(layout.showComposerTopBorder)],
      ['prompt', Number(layout.showPrompt)],
      ['input', layout.inputHeight],
      ['separator', Number(layout.showSeparator)],
      ['inspector', inspectorHeight],
      ['suggestions', layout.suggestionCount],
      ['gap', Number(layout.showGap)],
      ['transcript', shown],
      ['jump', Number(layout.showJump)],
      ['activity', layout.showLiveActivity ? 2 : 0],
    ], {inputHeight: layout.inputHeight, suggestionCount: layout.suggestionCount, panelActive: false, composerPosition: 'top'});
    return {...plan, ptyRows: capacity};
  }
  if (input.composerPosition === 'flow') {
    // Flow: the composer is part of the document, right after the newest output.
    // Geometry is measured as if following, so the PTY never resizes as output
    // grows or the view scrolls back.
    const followLayout = input.detached
      ? calculateScreenLayout(rows - inspectorHeight, input.inputRows, input.suggestions, input.running, false, input.hasOutput,
        input.contextPlacement, input.hasVisibleContext, input.composerLayout, input.composerDividers !== false)
      : layout;
    const capacity = followLayout.outputHeight;
    const total = Math.max(0, input.transcriptRows ?? capacity);
    // Following: the newest rows up to capacity. Scrolled back: from viewStart to
    // the end of output, and whatever composer rows still fit are clipped below.
    const shown = input.detached
      ? Math.min(rows, Math.max(0, total - (input.viewStart ?? 0)))
      : Math.min(capacity, total);
    const plan = build(rows, [
      ['transcript', shown],
      ['gap', Number(followLayout.showGap)],
      ['activity', followLayout.showLiveActivity ? 2 : 0],
      ['inspector', inspectorHeight],
      ['composerBorder', Number(followLayout.showComposerTopBorder)],
      ['prompt', Number(followLayout.showPrompt)],
      ['input', followLayout.inputHeight],
      ['separator', Number(followLayout.showSeparator)],
      // Menus open below the input, as a conventional terminal's completion list does.
      ['suggestions', followLayout.suggestionCount],
    ], {inputHeight: followLayout.inputHeight, suggestionCount: followLayout.suggestionCount, panelActive: false, composerPosition: 'flow'});
    // Only what is on screen: a composer scrolled partly off shows its first rows.
    return {...plan, ptyRows: capacity, viewportRows: Math.max(1, capacity),
      inputHeight: regionOf(plan, 'input')?.height ?? 0, suggestionCount: regionOf(plan, 'suggestions')?.height ?? 0};
  }
  return build(rows, [
    ['transcript', layout.outputHeight],
    ['gap', Number(layout.showGap)],
    ['jump', Number(layout.showJump)],
    ['suggestions', layout.suggestionCount],
    // Activity line plus its blank spacer.
    ['activity', layout.showLiveActivity ? 2 : 0],
    ['inspector', inspectorHeight],
    ['composerBorder', Number(layout.showComposerTopBorder)],
    ['prompt', Number(layout.showPrompt)],
    ['input', layout.inputHeight],
    ['separator', Number(layout.showSeparator)],
  ], {inputHeight: layout.inputHeight, suggestionCount: layout.suggestionCount, panelActive: false, composerPosition: 'bottom'});
}

function build(
  rows: number,
  stack: Array<[RegionKind, number]>,
  extra: Pick<ScreenPlan, 'inputHeight' | 'suggestionCount' | 'panelActive' | 'composerPosition'> & {panelPosition?: 'bottom' | 'top'},
): ScreenPlan {
  const regions: Region[] = [];
  let transcript: Region = {kind: 'transcript', top: 0, height: 0};
  let top = 0;
  for (const [kind, requested] of stack) {
    const height = Math.max(0, Math.min(requested, rows - top));
    const region = {kind, top, height};
    if (kind === 'transcript') transcript = region;
    if (height > 0) regions.push(region);
    top += height;
  }
  return {rows, regions, transcript, ptyRows: transcript.height, viewportRows: Math.max(1, transcript.height), panelPosition: 'bottom', ...extra};
}

/**
 * A plan with one owned status row above everything else. Every region moves
 * down by one, so hit-testing, cursor placement and viewport math stay in
 * agreement; the transcript keeps its own height.
 */
export function withStatusRow(plan: ScreenPlan): ScreenPlan {
  const shift = (region: Region): Region => ({...region, top: region.top + 1});
  return {...plan, rows: plan.rows + 1, regions: [{kind: 'status', top: 0, height: 1}, ...plan.regions.map(shift)], transcript: shift(plan.transcript)};
}

const COMPOSER_KINDS: ReadonlySet<RegionKind> = new Set(['composerBorder', 'prompt', 'input']);

/**
 * A plan (built for `plan.rows`) with `count` notice rows inserted immediately
 * above the composer. Regions from the composer on move down; nothing above it
 * moves, so the transcript keeps its geometry. Without a composer (a panel owns
 * the screen) the plan is returned unchanged.
 */
export function withNoticeRows(plan: ScreenPlan, count: number, kind: 'notices' | 'find' = 'notices'): ScreenPlan {
  const index = plan.regions.findIndex(region => COMPOSER_KINDS.has(region.kind));
  if (count <= 0 || index === -1 || plan.panelActive) return plan;
  const at = plan.regions[index]!.top;
  const shift = (region: Region): Region => (region.top >= at ? {...region, top: region.top + count} : region);
  const regions = [...plan.regions.slice(0, index), {kind, top: at, height: count}, ...plan.regions.slice(index).map(shift)];
  return {...plan, rows: plan.rows + count, regions, transcript: shift(plan.transcript)};
}

export function regionOf(plan: ScreenPlan, kind: RegionKind): Region | undefined {
  return plan.regions.find(region => region.kind === kind);
}

/** Resolves a zero-based screen row to the region painted there. */
export function regionAt(plan: ScreenPlan, row: number): RegionHit | undefined {
  for (const region of plan.regions) {
    if (row >= region.top && row < region.top + region.height) return {region, localRow: row - region.top};
  }
  return undefined;
}

/** One-based terminal row (mouse reports, CUP) to zero-based screen row. */
export function screenRowFromTerminal(terminalRow: number): number {
  return terminalRow - 1;
}

export function terminalRowFromScreen(screenRow: number): number {
  return screenRow + 1;
}

/**
 * Zero-based screen row of the terminal cursor. The caret lives in the input
 * region; while a panel owns the screen the (hidden) cursor parks at its top.
 */
export function cursorScreenRow(plan: ScreenPlan, caretRow: number): number {
  const input = regionOf(plan, 'input');
  const row = input
    ? input.top + Math.max(0, Math.min(input.height - 1, caretRow))
    : (regionOf(plan, 'panel')?.top ?? plan.transcript.top + plan.transcript.height);
  return Math.max(0, Math.min(plan.rows - 1, row));
}
