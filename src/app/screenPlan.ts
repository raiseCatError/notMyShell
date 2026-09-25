import type {ComposerLayout, ContextPlacement} from '../prompt/configuration.js';
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
  | 'suggestions'
  | 'activity'
  | 'composerBorder'
  | 'prompt'
  | 'input'
  | 'separator';

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
  running: boolean;
  detached: boolean;
  hasOutput: boolean;
  contextPlacement: ContextPlacement;
  hasVisibleContext: boolean;
  composerLayout: ComposerLayout;
  /** Rows of an active full-width panel; undefined when no panel owns the screen. */
  panelRows?: number;
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
  /** Rows given to the shell PTY: the transcript viewport height (v0.4 Bottom behavior). */
  ptyRows: number;
  panelActive: boolean;
}

export interface RegionHit {
  region: Region;
  /** Zero-based row within the region. */
  localRow: number;
}

export function planScreen(input: ScreenPlanInput): ScreenPlan {
  const rows = Math.max(1, input.rows);
  if (input.panelRows !== undefined) {
    // Panel takeover: the panel pins to the bottom edge and the transcript keeps the rest.
    const panelHeight = Math.min(rows, Math.max(0, input.panelRows));
    return build(rows, [
      ['transcript', rows - panelHeight],
      ['panel', panelHeight],
    ], {inputHeight: 0, suggestionCount: 0, panelActive: true});
  }
  const layout = calculateScreenLayout(
    rows,
    input.inputRows,
    input.suggestions,
    input.running,
    input.detached,
    input.hasOutput,
    input.contextPlacement,
    input.hasVisibleContext,
    input.composerLayout,
  );
  return build(rows, [
    ['transcript', layout.outputHeight],
    ['gap', Number(layout.showGap)],
    ['jump', Number(layout.showJump)],
    ['suggestions', layout.suggestionCount],
    // Activity line plus its blank spacer.
    ['activity', layout.showLiveActivity ? 2 : 0],
    ['composerBorder', Number(layout.showComposerTopBorder)],
    ['prompt', Number(layout.showPrompt)],
    ['input', layout.inputHeight],
    ['separator', Number(layout.showSeparator)],
  ], {inputHeight: layout.inputHeight, suggestionCount: layout.suggestionCount, panelActive: false});
}

function build(
  rows: number,
  stack: Array<[RegionKind, number]>,
  extra: Pick<ScreenPlan, 'inputHeight' | 'suggestionCount' | 'panelActive'>,
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
  return {rows, regions, transcript, ptyRows: transcript.height, ...extra};
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
