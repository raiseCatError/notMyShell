import {verticalRailRows, type RailPresentation, type RailRow} from '../prompt/railLayout.js';
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
  /** The optional NMSh status strip: one owned row at the top or bottom edge of the NMSh pane. */
  | 'status'
  /** Cross-session notices: frontend chrome immediately above the composer, never transcript. */
  | 'notices'
  /** The transcript find bar (query, match count, options); frontend chrome above the composer. */
  | 'find'
  /** Keep Awake's adjacent row (its own row, or the muted idle reminder): frontend chrome right next to the composer, never transcript. */
  | 'awake'
  /** Live contextual modules attached to the composer, never transcript. */
  | 'contextRail' | 'railGap' | 'railEdge';

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
  /** Already resolved visible Rail demand; capped to two rows and available view space. */
  contextRailRows?: number;
  railPresentation?: RailPresentation;
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
  /** Where this frame's Keep Awake accessory lives, when one is active (decided with the plan so every consumer agrees). */
  rail?: {presentation: RailPresentation; slots: {top: number; index: number}[]; edgeRow: number; start: number; end: number};
  awake?: {slot: 'topEdge' | 'bottomEdge' | 'adjacentRow' | 'inputTrailing'; expandedOnEdge: boolean};
}

/**
 * Whether each composer edge can host auxiliary text. A plain composer border
 * or separator is available; a header prompt row (the prompt drawn into the
 * top divider) occupies the top edge; no rule at all (dividers Off, a tiny
 * screen) is unavailable. Width is checked by the caller.
 */
export function composerEdgeStates(plan: ScreenPlan, contextPlacement: ContextPlacement): {topEdge: 'available' | 'occupied' | 'unavailable'; bottomEdge: 'available' | 'unavailable'} {
  const has = (kind: RegionKind) => plan.regions.some(region => region.kind === kind && region.height > 0);
  return {
    topEdge: has('composerBorder') ? 'available' : has('prompt') && contextPlacement === 'header' ? 'occupied' : 'unavailable',
    bottomEdge: has('separator') ? 'available' : 'unavailable',
  };
}

export interface RegionHit {
  region: Region;
  /** Zero-based row within the region. */
  localRow: number;
}

export function planScreen(input: ScreenPlanInput): ScreenPlan {
  if (input.railPresentation?.rows && input.panelRows === undefined) {
    const base = planScreen({...input, railPresentation: undefined, contextRailRows: 0});
    const composed = withRailPresentation(base, input.railPresentation);
    if (input.composerPosition === 'flow' && input.detached) {
      // Measure the complete group independently of viewport clipping. Scrolling
      // the input offscreen must not resize the hidden shell's terminal.
      const reference = planScreen({...input, detached: false, transcriptRows: 0, railPresentation: undefined, contextRailRows: 0});
      const measured = withRailPresentation(reference, input.railPresentation);
      const reserved = reference.ptyRows - measured.ptyRows;
      return {...composed, ptyRows: measured.ptyRows, viewportRows: Math.max(1, base.viewportRows - reserved)};
    }
    return composed;
  }
  if (input.contextRailRows && input.panelRows === undefined) {
    return withContextRail(planScreen({...input, contextRailRows: 0}), input.contextRailRows);
  }
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

/** Compile a declarative group stack while preserving the input's existing anchor. */
function withRailPresentation(plan: ScreenPlan, presentation: RailPresentation): ScreenPlan {
  const input = regionOf(plan, 'input');
  if (!input) return plan.composerPosition === 'flow'
    ? {...plan, ptyRows: Math.max(1, plan.ptyRows - presentation.rows), viewportRows: Math.max(1, plan.viewportRows - presentation.rows)} : plan;
  const top = plan.composerPosition === 'top';
  const members = ['composerBorder', 'prompt', 'input', 'separator', ...(top ? ['inspector', 'suggestions'] : [])];
  const start = Math.min(...plan.regions.filter(r => members.includes(r.kind)).map(r => r.top));
  const end = Math.max(...plan.regions.filter(r => members.includes(r.kind) && r.top >= start).map(r => r.top + r.height));
  type Token = {kind: RegionKind; height: number; row?: RailRow};
  let tokens: Token[] = plan.regions.filter(r => r.top >= start && r.top < end).map(r => ({kind: r.kind, height: r.height}));
  const p = {...presentation};
  // Keep one usable transcript row; optional decoration yields before content.
  const maximum = Math.max(0, plan.ptyRows - 1);
  let railRows = verticalRailRows(p, top);
  while (railRows.length > maximum && railRows.some(r => r.kind === 'gap')) railRows.splice(railRows.findIndex(r => r.kind === 'gap'), 1);
  if (p.relation === 'vertical' && railRows.length > maximum && railRows.some(r => r.kind === 'edge')) {
    railRows = railRows.filter(r => r.kind !== 'edge');
    p.anchor = 'rail';
  }
  if (p.relation === 'vertical' && railRows.length > maximum) {
    railRows = railRows.slice(0, maximum);
    if (!railRows.length) return plan;
  }
  const token = (row: RailRow): Token => ({kind: row.kind === 'content' ? 'contextRail' : row.kind === 'gap' ? 'railGap' : 'railEdge', height: 1, row});
  if (p.relation === 'vertical') {
    if (p.inside) tokens = tokens.filter(t => t.kind !== (top ? 'separator' : 'composerBorder'));
    tokens = top ? [...tokens, ...railRows.map(token)] : [...railRows.map(token), ...tokens];
  } else {
    const main = tokens.find(t => t.kind === 'prompt') ?? tokens.find(t => t.kind === 'input')!;
    const edge = tokens.find(t => t.kind === 'composerBorder');
    const primary = p.inside && p.anchor === 'rail' && edge ? edge : main;
    const hasSecondary = primary !== main || main.kind === 'prompt' || input.height > 1;
    if (p.rows === 2 && !hasSecondary && maximum) {
      const secondary = token({kind: 'content', index: 1});
      tokens = top ? [...tokens, secondary] : [secondary, ...tokens];
    }
    if (p.inside && p.anchor === 'above') {
      tokens = tokens.filter(t => t !== edge);
      tokens.unshift(edge ?? token({kind: 'edge'}));
    }
  }
  const before = tokens.slice(0, tokens.findIndex(t => t.kind === 'input')).reduce((n, t) => n + t.height, 0);
  const deltaBefore = before - (input.top - start);
  const total = tokens.reduce((n, t) => n + t.height, 0);
  const delta = total - (end - start);
  const removed = top ? 0 : Math.min(deltaBefore, plan.transcript.height);
  const extra = top ? 0 : deltaBefore - removed;
  const groupStart = top ? start : start - removed;
  let row = groupStart;
  const group: Region[] = tokens.map(t => { const r = {kind: t.kind, top: row, height: t.height}; row += t.height; return r; });
  const slots = tokens.flatMap((t, i) => t.row?.kind === 'content' ? [{top: group[i]!.top, index: t.row.index}] : []);
  const main = group.find(r => r.kind === 'prompt') ?? group.find(r => r.kind === 'input')!;
  const edge = group.find(r => r.kind === 'composerBorder');
  if (p.relation === 'right') {
    const primary = p.inside && p.anchor === 'rail' && edge ? edge : main;
    slots.push({top: primary.top, index: 0});
    if (p.rows === 2 && !slots.some(slot => slot.index === 1)) slots.push({top: primary !== main ? main.top : main.kind === 'prompt' ? group.find(r => r.kind === 'input')!.top : main.top + 1, index: 1});
  }
  const boundary = group.find(r => r.kind === 'railEdge');
  const edgeRow = boundary ? boundary.top : p.anchor === 'above' ? (edge ?? main).top
    : p.anchor === 'rail' ? (top && p.relation === 'vertical' ? slots.at(-1)!.top : slots[0]!.top) : (edge ?? main).top;
  const transcript = {...plan.transcript, top: top ? plan.transcript.top + delta : plan.transcript.top,
    height: Math.max(0, plan.transcript.height - (top ? Math.max(0, delta - (plan.ptyRows - plan.transcript.height)) : removed))};
  const outside = plan.regions.filter(r => r.top < start || r.top >= end).map(r => r.kind === 'transcript' ? transcript
    : top ? (r.top >= end ? {...r, top: r.top + delta} : r)
      : r.top >= end ? {...r, top: r.top + extra + delta - deltaBefore} : {...r, top: r.top - removed});
  const regions = [...outside, ...group].filter(r => r.height > 0 && r.top >= 0 && r.top < plan.rows)
    .map(r => ({...r, height: Math.min(r.height, plan.rows - r.top)})).sort((a,b) => a.top-b.top);
  return {...plan, regions, transcript, ptyRows: Math.max(1, plan.ptyRows - delta),
    viewportRows: Math.max(1, plan.composerPosition === 'flow' ? transcript.height : plan.viewportRows - delta),
    rail: {presentation: p, slots: slots.filter(slot => slot.top >= 0 && slot.top < plan.rows), edgeRow,
      start: groupStart, end: Math.min(plan.rows, row)}};
}

/** Compatibility input for older callers; all Rail geometry uses one compiler. */
function withContextRail(plan: ScreenPlan, requested: number): ScreenPlan {
  const count = Math.min(2, Math.max(0, Math.floor(requested)));
  const result = withRailPresentation(plan, {relation: 'vertical', inside: false,
    anchor: 'prompt', mirrored: false, rows: count, gap: 0, between: 0,
    width: 0, column: 0, editorColumns: 0});
  // Historical callers address a contiguous Rail region by local row.
  const regions: Region[] = [];
  for (const region of result.regions) {
    const previous = regions.at(-1);
    if (region.kind === 'contextRail' && previous?.kind === 'contextRail' && previous.top + previous.height === region.top)
      previous.height += region.height;
    else regions.push({...region});
  }
  return {...result, regions};
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
 * A plan with one owned status row at an edge of the NMSh pane. At the top
 * every region moves down by one; at the bottom nothing moves and the row is
 * the pane's last (inside tmux that is above tmux's own status line, which
 * lies outside the pane). Hit-testing, cursor placement and viewport math stay
 * in agreement either way; the transcript keeps its own height.
 */
export function withStatusRow(plan: ScreenPlan, edge: 'top' | 'bottom' = 'top'): ScreenPlan {
  if (edge === 'bottom') return {...plan, rows: plan.rows + 1, regions: [...plan.regions, {kind: 'status', top: plan.rows, height: 1}]};
  const shift = (region: Region): Region => ({...region, top: region.top + 1});
  return {...plan, rows: plan.rows + 1, regions: [{kind: 'status', top: 0, height: 1}, ...plan.regions.map(shift)], transcript: shift(plan.transcript)};
}

const COMPOSER_KINDS: ReadonlySet<RegionKind> = new Set(['composerBorder', 'prompt', 'input', 'contextRail', 'railGap', 'railEdge']);

/**
 * A plan (built for `plan.rows`) with `count` notice rows inserted immediately
 * above the composer. Regions from the composer on move down; nothing above it
 * moves, so the transcript keeps its geometry. Without a composer (a panel owns
 * the screen) the plan is returned unchanged.
 */
export function withNoticeRows(plan: ScreenPlan, count: number, kind: 'notices' | 'find' | 'awake' = 'notices'): ScreenPlan {
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
