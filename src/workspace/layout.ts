/**
 * Horizontal workspace geometry (#330): where the left Workspace Sidebar, the
 * center (transcript and composer) and the right detail panel sit in one
 * frame, and how many columns the shell's PTY gets. It is the column
 * counterpart of ScreenPlan (rows): render, hit-testing, cursor placement and
 * PTY sizing consume the same plan, so they cannot disagree.
 *
 * Modes, measured in terminal cells:
 *
 *   docked   the region takes its own columns; the center (and the PTY) is narrower
 *   compact  a narrower docked sidebar (markers and short labels)
 *   drawer   the region is drawn over the center while it is open; the center and
 *            the PTY keep their width, so opening or closing it never resizes the shell
 *   hidden   closed, or suppressed (fullscreen/raw passthrough, idle screens own the pane)
 *
 * The center never drops below CENTER_MIN_COLUMNS because of a docked region:
 * a region that cannot dock becomes a drawer instead. Coordinates are
 * zero-based columns; one divider cell separates a docked region from the center.
 */

export type DockMode = 'hidden' | 'docked' | 'compact' | 'drawer';

/** A shell narrower than this stops being useful for ordinary output; docked regions never squeeze it below. */
export const CENTER_MIN_COLUMNS = 60;
export const SIDEBAR_DOCKED_COLUMNS = 28;
export const SIDEBAR_COMPACT_COLUMNS = 18;
export const PANEL_MIN_COLUMNS = 36;
export const PANEL_MAX_COLUMNS = 72;
/** A drawer narrower than this would not show a useful row; below it the drawer takes the whole width. */
export const DRAWER_MIN_COLUMNS = 24;
const DIVIDER = 1;

export interface ColumnRegion {
  /** Zero-based first column. */
  x: number;
  width: number;
}

export interface WorkspaceColumnsInput {
  columns: number;
  sidebarOpen: boolean;
  panelOpen: boolean;
  /** A preferred panel width (cells), clamped to the panel's bounds; defaults to about 38% of the width. */
  panelWidth?: number;
  /** Fullscreen/raw passthrough or an idle screen owns the whole pane: no workspace chrome. */
  suppressed?: boolean;
}

export interface WorkspaceRegion {
  mode: DockMode;
  /** Absent while hidden. A drawer's region overlaps the center. */
  region?: ColumnRegion;
}

export interface WorkspaceColumns {
  columns: number;
  sidebar: WorkspaceRegion;
  panel: WorkspaceRegion;
  /** Transcript, composer and everything else the frontend draws in the middle. */
  center: ColumnRegion;
  /** Columns the shell's PTY is sized to: the center's width (drawers never change it). */
  ptyColumns: number;
  /** Zero-based columns holding a vertical divider between a docked region and the center. */
  dividers: readonly number[];
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function panelWidth(input: WorkspaceColumnsInput): number {
  return clamp(Math.round(input.panelWidth ?? input.columns * 0.38), PANEL_MIN_COLUMNS, PANEL_MAX_COLUMNS);
}

function drawerWidth(columns: number, preferred: number): number {
  return columns < DRAWER_MIN_COLUMNS * 2 ? columns : Math.max(DRAWER_MIN_COLUMNS, Math.min(preferred, columns - 4));
}

/**
 * The frame's column plan. Docking is decided sidebar first (docked, then compact), then the panel; when both do not
 * fit beside a useful center the sidebar narrows to compact before the panel becomes a drawer. Deterministic for a
 * given input, so a resize back to an earlier width restores the earlier layout.
 */
export function planWorkspaceColumns(input: WorkspaceColumnsInput): WorkspaceColumns {
  const columns = Math.max(1, Math.floor(input.columns));
  const full: ColumnRegion = {x: 0, width: columns};
  if (input.suppressed || (!input.sidebarOpen && !input.panelOpen)) {
    return {columns, sidebar: {mode: 'hidden'}, panel: {mode: 'hidden'}, center: full, ptyColumns: columns, dividers: []};
  }
  const panel = input.panelOpen ? panelWidth(input) : 0;
  const fits = (side: number, right: number) => columns - (side ? side + DIVIDER : 0) - (right ? right + DIVIDER : 0) >= CENTER_MIN_COLUMNS;
  let sideMode: DockMode = 'hidden', side = 0;
  if (input.sidebarOpen) {
    if (fits(SIDEBAR_DOCKED_COLUMNS, 0)) { sideMode = 'docked'; side = SIDEBAR_DOCKED_COLUMNS; }
    else if (fits(SIDEBAR_COMPACT_COLUMNS, 0)) { sideMode = 'compact'; side = SIDEBAR_COMPACT_COLUMNS; }
    else sideMode = 'drawer';
  }
  let panelMode: DockMode = 'hidden';
  if (input.panelOpen) {
    if (fits(sideMode === 'drawer' ? 0 : side, panel)) panelMode = 'docked';
    else if (sideMode === 'docked' && fits(SIDEBAR_COMPACT_COLUMNS, panel)) { sideMode = 'compact'; side = SIDEBAR_COMPACT_COLUMNS; panelMode = 'docked'; }
    else panelMode = 'drawer';
  }
  const leftDocked = sideMode === 'docked' || sideMode === 'compact';
  const rightDocked = panelMode === 'docked';
  const centerX = leftDocked ? side + DIVIDER : 0;
  const centerWidth = columns - centerX - (rightDocked ? panel + DIVIDER : 0);
  const center: ColumnRegion = {x: centerX, width: centerWidth};
  const dividers: number[] = [];
  if (leftDocked) dividers.push(side);
  if (rightDocked) dividers.push(centerX + centerWidth);
  const sidebar: WorkspaceRegion = sideMode === 'hidden' ? {mode: 'hidden'}
    : leftDocked ? {mode: sideMode, region: {x: 0, width: side}}
      : {mode: 'drawer', region: {x: 0, width: drawerWidth(columns, SIDEBAR_DOCKED_COLUMNS)}};
  const right: WorkspaceRegion = panelMode === 'hidden' ? {mode: 'hidden'}
    : rightDocked ? {mode: 'docked', region: {x: columns - panel, width: panel}}
      : (() => { const width = drawerWidth(columns, panel); return {mode: 'drawer' as const, region: {x: columns - width, width}}; })();
  return {columns, sidebar, panel: right, center, ptyColumns: centerWidth, dividers};
}

export type ColumnHit = 'sidebar' | 'panel' | 'center' | 'divider';

/**
 * What a pointer at a zero-based column lands on. Drawers are on top of the center, so they win where they overlap;
 * the pointer then invokes the same semantic actions as the keyboard.
 */
export function columnAt(plan: WorkspaceColumns, column: number): ColumnHit | undefined {
  if (column < 0 || column >= plan.columns) return undefined;
  const inside = (region: ColumnRegion | undefined) => region !== undefined && column >= region.x && column < region.x + region.width;
  if (plan.sidebar.mode === 'drawer' && inside(plan.sidebar.region)) return 'sidebar';
  if (plan.panel.mode === 'drawer' && inside(plan.panel.region)) return 'panel';
  if (plan.dividers.includes(column)) return 'divider';
  if (inside(plan.sidebar.region)) return 'sidebar';
  if (inside(plan.panel.region)) return 'panel';
  return inside(plan.center) ? 'center' : undefined;
}

/** A center-relative column (what the transcript/composer renderers use) to the frame's column. */
export function frameColumn(plan: WorkspaceColumns, centerColumn: number): number {
  return plan.center.x + Math.max(0, Math.min(plan.center.width - 1, centerColumn));
}
