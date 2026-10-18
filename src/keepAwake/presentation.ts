import {semanticIcon} from '../prompt/glyphChoices.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth} from '../util/text.js';
import {formatDuration, MODE_LABELS, type KeepAwakeMode} from './keepAwake.js';

/**
 * Keep Awake presentation: how an active assertion shows up in NMSh chrome.
 *
 * Keep Awake is NMSh-owned composer chrome, never prompt or provider output.
 * The prompt owns its structural space and this accessory moves around it:
 * it takes a free composer edge, else a row adjacent to the composer, and
 * never truncates or rewrites prompt, right prompt or editor content. When
 * Keep Awake is off nothing here renders anything.
 */

export const AWAKE_PLACEMENTS = ['edge', 'above', 'input'] as const;
export type AwakePlacement = typeof AWAKE_PLACEMENTS[number];
export const AWAKE_PLACEMENT_LABELS: Record<AwakePlacement, string> = {edge: 'Composer edge', above: 'Above composer', input: 'Input row'};

export const AWAKE_DISPLAYS = ['text', 'icon', 'iconText'] as const;
export type AwakeDisplay = typeof AWAKE_DISPLAYS[number];
export const AWAKE_DISPLAY_LABELS: Record<AwakeDisplay, string> = {text: 'Text', icon: 'Icon', iconText: 'Icon + text'};

export const AWAKE_SAVER_POSITIONS = ['topLeft', 'topCenter', 'topRight', 'bottomLeft', 'bottomCenter', 'bottomRight'] as const;
export type AwakeSaverPosition = typeof AWAKE_SAVER_POSITIONS[number];
export const AWAKE_SAVER_POSITION_LABELS: Record<AwakeSaverPosition, string> = {
  topLeft: 'Top left', topCenter: 'Top center', topRight: 'Top right', bottomLeft: 'Bottom left', bottomCenter: 'Bottom center', bottomRight: 'Bottom right',
};

export const AWAKE_IDLE_AFTER = [15, 30, 60, 120, 300] as const;

export interface KeepAwakePresentation {
  placement: AwakePlacement;
  display: AwakeDisplay;
  /** Expand to duration + the muted stop hint after no NMSh input for `idleAfterSeconds`. */
  idleReminder: boolean;
  idleAfterSeconds: number;
  screensaver: boolean;
  screensaverPosition: AwakeSaverPosition;
}

export const DEFAULT_KEEP_AWAKE_PRESENTATION: Readonly<KeepAwakePresentation> = {
  placement: 'edge', display: 'text', idleReminder: true, idleAfterSeconds: 30, screensaver: true, screensaverPosition: 'bottomLeft',
};

export function normalizeKeepAwakePresentation(value: unknown): KeepAwakePresentation {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const d = DEFAULT_KEEP_AWAKE_PRESENTATION;
  const pick = <T extends string>(list: readonly T[], key: string, fallback: T): T => list.includes(v[key] as T) ? v[key] as T : fallback;
  return {
    placement: pick(AWAKE_PLACEMENTS, 'placement', d.placement),
    display: pick(AWAKE_DISPLAYS, 'display', d.display),
    idleReminder: typeof v.idleReminder === 'boolean' ? v.idleReminder : d.idleReminder,
    idleAfterSeconds: AWAKE_IDLE_AFTER.includes(v.idleAfterSeconds as typeof AWAKE_IDLE_AFTER[number]) ? v.idleAfterSeconds as number : d.idleAfterSeconds,
    screensaver: typeof v.screensaver === 'boolean' ? v.screensaver : d.screensaver,
    screensaverPosition: pick(AWAKE_SAVER_POSITIONS, 'screensaverPosition', d.screensaverPosition),
  };
}

/** The facts presentation needs: the same record the controller verified. */
export interface AwakeFacts {mode: KeepAwakeMode; startedAt: number; timeoutSeconds?: number}

/** How much of the label fits: full (Awake · Display), short (Awake) or glyph (the icon alone, when the glyph mode has one). */
export type AwakeForm = 'full' | 'short' | 'glyph';

/** Plain label text. Icon mode falls back to text when the glyph mode has no icon (Safe/ASCII). */
export function awakeLabel(facts: AwakeFacts, display: AwakeDisplay, form: AwakeForm = 'full', icon = semanticIcon('awake')): string {
  const text = form === 'full' ? `Awake · ${MODE_LABELS[facts.mode]}` : 'Awake';
  if (form === 'glyph') return icon || 'Awake';
  if (display === 'icon' && icon) return form === 'full' ? `${icon} ${MODE_LABELS[facts.mode]}` : icon;
  if (display === 'iconText' && icon) return `${icon} ${text}`;
  return text;
}

/** Elapsed time, or what is left when a timeout was set: factual and coarse (no seconds after the first minute). */
export function awakeDuration(facts: AwakeFacts, now: number): string {
  const elapsed = Math.max(0, Math.floor((now - facts.startedAt) / 1000));
  if (facts.timeoutSeconds) {
    const left = Math.max(0, facts.timeoutSeconds - elapsed);
    return `${formatDuration(left >= 60 ? left - left % 60 : left)} left`;
  }
  return formatDuration(elapsed >= 60 ? elapsed - elapsed % 60 : Math.max(1, elapsed));
}

export const AWAKE_STOP_HINT = '/zoomies stop';

/** Semantic roles: informational while active, the same identity muted for the idle reminder. Theme-aware; NO_COLOR and 256-color follow colorEscape. */
export const awakeStyle = {
  active: () => foreground(UI_COLORS.accent),
  muted: () => foreground(UI_COLORS.subtle),
  failure: () => foreground(UI_COLORS.failure),
  reset: '\u001b[0m',
};

// ---- Composer accessory slots ------------------------------------------------------------------

export type SlotState = 'available' | 'occupied' | 'unavailable';
export type AccessorySlot = 'topEdge' | 'bottomEdge' | 'adjacentRow' | 'inputTrailing';

export interface ComposerSlots {topEdge: SlotState; bottomEdge: SlotState; inputTrailing: SlotState}

/**
 * Resolved every frame from real composer geometry. The saved preference is
 * never changed by a fallback: Composer edge means "a free edge if there is
 * one", Input row means "only when it is completely safe".
 */
export function resolveAccessorySlot(placement: AwakePlacement, slots: ComposerSlots): AccessorySlot {
  if (placement === 'above') return 'adjacentRow';
  if (placement === 'input') return slots.inputTrailing === 'available' ? 'inputTrailing' : 'adjacentRow';
  if (slots.topEdge === 'available') return 'topEdge';
  if (slots.bottomEdge === 'available') return 'bottomEdge';
  return 'adjacentRow';
}

/** Rule cells kept on each side of an accessory, so the edge still reads as a divider. */
export const EDGE_LEAD_MIN = 6;
export const EDGE_TRAIL = 2;

/** Whether an accessory of this width fits on an edge of `columns` cells. */
export function edgeFits(columns: number, accessoryWidth: number): boolean {
  return accessoryWidth > 0 && columns >= accessoryWidth + 2 + EDGE_LEAD_MIN + EDGE_TRAIL;
}

/**
 * Cells [start, end) of an ANSI string, carrying the SGR state in effect at
 * `start`. Divider rules are single-width glyphs, which is all this needs.
 */
export function sliceAnsiCells(value: string, start: number, end: number): string {
  let out = '';
  let lastSgr = '';
  let cell = 0;
  const pattern = /(\u001b\[[0-?]*[ -/]*[@-~])|([\s\S])/gu;
  for (const match of value.matchAll(pattern)) {
    if (match[1]) {
      if (cell < start) { if (match[1].endsWith('m')) lastSgr = match[1]; }
      else if (cell < end) out += match[1];
      continue;
    }
    const width = displayWidth(match[2]!);
    if (cell >= start && cell + width <= end) out += match[2];
    cell += width;
    if (cell >= end) break;
  }
  return `${lastSgr}${out}`;
}

/**
 * One composer edge: the painted rule with the accessory set into its
 * trailing portion. The result is exactly `width` cells; the rule keeps its
 * own colors (and Chroma) and the accessory keeps its own, so animating the
 * rule never touches the accessory text.
 */
export function renderComposerEdge(options: {rule: string; width: number; accessory?: {ansi: string; width: number}}): string {
  const {rule, width, accessory} = options;
  if (!accessory || !edgeFits(width, accessory.width)) return rule;
  const lead = width - accessory.width - 2 - EDGE_TRAIL;
  return `${sliceAnsiCells(rule, 0, lead)}\u001b[0m ${accessory.ansi} \u001b[0m${sliceAnsiCells(rule, width - EDGE_TRAIL, width)}\u001b[0m`;
}

/** Columns the accessory occupies on a composed edge row (for keeping transition tints off it). */
export function edgeAccessoryColumns(width: number, accessoryWidth: number): {start: number; end: number} | undefined {
  if (!edgeFits(width, accessoryWidth)) return undefined;
  const start = width - accessoryWidth - 1 - EDGE_TRAIL;
  return {start, end: start + accessoryWidth};
}

// ---- What to show this frame -----------------------------------------------------------------

export interface AwakeView {
  /** Compact label for an edge or the input row, styled. */
  compact: {ansi: string; width: number};
  /** The idle form for the same slot when it fits; otherwise undefined and `reminder` carries the extra facts. */
  expanded?: {ansi: string; width: number};
  /** Muted duration + stop hint for one adjacent row (never repeating the compact label). */
  reminder: {ansi: string; width: number};
  /** One self-contained row for the adjacent slot: compact, plus the idle facts while idle. */
  row: (columns: number) => string;
}

const styled = (text: string, style: string) => ({ansi: `${style}${text}${awakeStyle.reset}`, width: displayWidth(text)});

export function awakeView(facts: AwakeFacts, settings: KeepAwakePresentation, idle: boolean, now: number, icon = semanticIcon('awake')): AwakeView {
  const label = awakeLabel(facts, settings.display, 'full', icon);
  const duration = awakeDuration(facts, now);
  const compact = styled(label, awakeStyle.active());
  const expandedText = `${label} · ${duration}`;
  const expanded = {ansi: `${awakeStyle.active()}${label}${awakeStyle.reset}${awakeStyle.muted()} · ${duration}   ${AWAKE_STOP_HINT}${awakeStyle.reset}`,
    width: displayWidth(`${expandedText}   ${AWAKE_STOP_HINT}`)};
  const reminder = styled(`${duration}   ${AWAKE_STOP_HINT}`, awakeStyle.muted());
  return {
    compact,
    ...(idle ? {expanded} : {}),
    reminder,
    row: (columns: number) => {
      if (!idle) return fitRow(compact, columns);
      const gap = columns - displayWidth(expandedText) - displayWidth(AWAKE_STOP_HINT) - 1;
      if (gap >= 2) return `${awakeStyle.active()}${label}${awakeStyle.reset}${awakeStyle.muted()} · ${duration}${' '.repeat(gap)}${AWAKE_STOP_HINT}${awakeStyle.reset}`;
      return fitRow(compact, columns);
    },
  };
}

function fitRow(part: {ansi: string; width: number}, columns: number): string {
  return part.width <= columns ? part.ansi : `${awakeStyle.active()}Awake${awakeStyle.reset}`;
}

// ---- Screensaver --------------------------------------------------------------------------

/** The positioned screensaver status (one row, inset one cell from the frame edge). */
export function placeOnSaver(rows: readonly string[], columns: number, text: {ansi: string; width: number}, position: AwakeSaverPosition,
  overlay: (row: string, column: number, ansi: string, width: number) => string): string[] {
  if (!rows.length || text.width + 2 > columns) return [...rows];
  const row = position.startsWith('top') ? 0 : rows.length - 1;
  const column = position.endsWith('Left') ? 1 : position.endsWith('Right') ? columns - text.width - 1 : Math.floor((columns - text.width) / 2);
  const out = [...rows];
  out[row] = overlay(out[row] ?? '', column, text.ansi, text.width);
  return out;
}
