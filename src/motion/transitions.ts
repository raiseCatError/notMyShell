import {mixRgb} from '../chroma/chroma.js';
import type {MotionRendering, MotionSettings} from '../prompt/configuration.js';
import type {CellPaint} from '../presentation/cellOverlay.js';
import {UI_COLORS, type RgbColor} from '../ui/palette.js';

/**
 * NMSh's short, finite presentation transitions in one place, so they share
 * one clock, one visual language and one composition order:
 *
 *   launch       Command Transfer: Enter handed the command to the shell
 *   materialize  what completion just inserted
 *   seal         Block Seal: a finished block settles
 *   echo         Semantic Echo: a meaningful event (long success, failure, attention…)
 *   morph        prompt modules transform when their facts change
 *
 * Each is state (start, duration, target) plus a pure paint function; the
 * logical state they present has already changed. Paints only tint cell
 * the foreground of cells that already hold text (tint, brightness, underline;
 * see cellOverlay), never a background: SGR has no per-cell alpha, so a
 * background would be an opaque box on a transparent terminal, and the host's
 * own background is always preserved. Text and widths never move or flash.
 * Nothing is stored in transcripts or snapshots. With nothing active there is
 * no clock at all.
 */
export type SemanticEvent = 'longSuccess' | 'failure' | 'interrupted' | 'conflict' | 'attention' | 'taskDone' | 'taskFailed' | 'setupDone' | 'setupFailed' | 'installDone' | 'installFailed';
export type Tone = 'success' | 'failure' | 'muted' | 'attention' | 'warning' | 'accent';

export const EVENT_TONES: Record<SemanticEvent, Tone> = {longSuccess: 'success', failure: 'failure', interrupted: 'muted', conflict: 'warning', attention: 'attention',
  taskDone: 'success', taskFailed: 'failure', setupDone: 'success', setupFailed: 'failure', installDone: 'success', installFailed: 'failure'};

/** How a transition is drawn: the renderer and how strongly. Chosen once per event from the Motion settings. */
export interface MotionLook {rendering: MotionRendering; intensity: number}
export const CLEAN_LOOK: MotionLook = {rendering: 'clean', intensity: 1};
const INTENSITY = {low: 0.6, medium: 1, high: 1.4} as const;
/** Duration multipliers: Slow lasts longer, Fast is shorter. */
const SPEED = {slow: 1.5, normal: 1, fast: 0.65} as const;

/** The look and timing for the selected rendering (each rendering keeps its own tuning). Tolerates settings saved before rendering existed. */
export function lookFor(motion: MotionSettings): MotionLook & {speed: number} {
  const rendering = motion.rendering === 'rich' ? 'rich' : 'clean';
  const tuning = motion.tuning?.[rendering];
  return {rendering, intensity: INTENSITY[tuning?.intensity ?? 'medium'], speed: SPEED[tuning?.speed ?? 'normal']};
}

export type Transition =
  | {kind: 'launch'; style: 'sweep' | 'pulse'; start: number; duration: number; look: MotionLook}
  | {kind: 'materialize'; from: number; to: number; text: string; vivid: boolean; start: number; duration: number; look: MotionLook}
  | {kind: 'seal'; blockStartId: number; tone: Tone; start: number; duration: number; look: MotionLook}
  | {kind: 'echo'; event: SemanticEvent; expressive: boolean; start: number; duration: number; look: MotionLook}
  | {kind: 'morph'; changes: ModuleChange[]; expressive: boolean; start: number; duration: number; look: MotionLook};

export interface ModuleChange {id: string; text: string; change: 'changed' | 'appeared' | 'disappeared'; role?: string}

export const DURATIONS = {launch: 170, materializeSubtle: 150, materializeVivid: 260, seal: 240, echoSubtle: 380, echoExpressive: 620, morphSubtle: 150, morphExpressive: 260} as const;

/** Whether decorative motion may run at all right now (Reduced Motion, Effects Off, NO_COLOR win). */
export interface MotionGate {reducedMotion: boolean; effectsOff: boolean; color: boolean}
export const motionAllowed = (gate: MotionGate) => !gate.reducedMotion && !gate.effectsOff && gate.color;

export class Transitions {
  private active: Transition[] = [];

  constructor(private readonly settings: () => MotionSettings, private readonly gate: () => MotionGate) {}

  private allowed(): boolean { return motionAllowed(this.gate()); }

  /** Look and speed for an event starting now; the speed scales its duration. */
  private tuned(duration: number): {look: MotionLook; duration: number} {
    const {speed, ...look} = lookFor(this.settings());
    return {look, duration: Math.max(40, Math.round(duration * speed))};
  }

  /** Enter submitted a shell command (never Ask or an agent composer). */
  launch(now: number): void {
    const style = this.settings().commandLaunch;
    if (style === 'off' || !this.allowed()) return;
    this.replace('launch', {kind: 'launch', style, start: now, ...this.tuned(DURATIONS.launch)});
  }

  /** Completion inserted [from, to) (editor grapheme indices). A newer completion replaces the older one. */
  materialize(from: number, to: number, text: string, now: number): void {
    const level = this.settings().completionHighlight;
    if (level === 'off' || to <= from || !this.allowed()) return;
    this.replace('materialize', {kind: 'materialize', from, to, text, vivid: level === 'vivid', start: now, ...this.tuned(level === 'vivid' ? DURATIONS.materializeVivid : DURATIONS.materializeSubtle)});
  }

  /** The editor changed some other way: a stale materialization range must not linger. */
  editorChanged(text: string): void {
    this.active = this.active.filter(item => item.kind !== 'materialize' || item.text === text);
  }

  seal(blockStartId: number, outcome: 'success' | 'failure' | 'interrupted', now: number): void {
    if (this.settings().completionEffect === 'off' || !this.allowed()) return;
    this.active = this.active.filter(item => item.kind !== 'seal');
    this.active.push({kind: 'seal', blockStartId, tone: outcome === 'success' ? 'success' : outcome === 'failure' ? 'failure' : 'muted', start: now, ...this.tuned(DURATIONS.seal)});
  }

  echo(event: SemanticEvent, now: number): void {
    const level = this.settings().eventFeedback;
    if (level === 'off' || !this.allowed()) return;
    // One echo at a time: a newer meaningful event replaces the older one (no stacked flashes).
    this.replace('echo', {kind: 'echo', event, expressive: level === 'expressive', start: now, ...this.tuned(level === 'expressive' ? DURATIONS.echoExpressive : DURATIONS.echoSubtle)});
  }

  /** Prompt facts changed: one epoch for every module that changed together; a newer epoch retargets. */
  morph(changes: ModuleChange[], now: number): void {
    const level = this.settings().contextTransitions;
    if (level === 'off' || !changes.length || !this.allowed()) return;
    this.replace('morph', {kind: 'morph', changes, expressive: level === 'expressive', start: now, ...this.tuned(level === 'expressive' ? DURATIONS.morphExpressive : DURATIONS.morphSubtle)});
  }

  private replace(kind: Transition['kind'], transition: Transition): void {
    this.active = [...this.active.filter(item => item.kind !== kind), transition];
  }

  cancel(kind?: Transition['kind']): void { this.active = kind ? this.active.filter(item => item.kind !== kind) : []; }

  /** Live transitions at `now` (finished ones are dropped); Reduced Motion and friends end everything at once. */
  live(now: number): Transition[] {
    if (!this.allowed()) { this.active = []; return []; }
    this.active = this.active.filter(item => now - item.start < item.duration);
    return this.active;
  }

  get busy(): boolean { return this.active.length > 0; }
}

export function toneColor(tone: Tone): RgbColor {
  return tone === 'success' ? UI_COLORS.success : tone === 'failure' ? UI_COLORS.failure : tone === 'warning' ? WARNING
    : tone === 'muted' ? UI_COLORS.subtle : UI_COLORS.accent;
}

const WARNING: RgbColor = {red: 224, green: 176, blue: 72};
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** A luminance band travelling left → right across [0, width) at progress t: a foreground tint, strongest at the band's center. */
export function sweepCells(width: number, t: number, color: RgbColor, strength: number, band = 10): Map<number, CellPaint> {
  const cells = new Map<number, CellPaint>();
  const center = -band + t * (width + band * 2);
  for (let column = Math.max(0, Math.floor(center - band)); column < Math.min(width, Math.ceil(center + band)); column += 1) {
    const falloff = 1 - Math.abs(column - center) / band;
    if (falloff > 0) cells.set(column, {tint: {color, amount: clamp01(falloff * strength)}});
  }
  return cells;
}

/** A foreground tint over [from, to) that decays to nothing; `underline` marks the range while it is still strong. */
export function decayCells(from: number, to: number, t: number, color: RgbColor, strength: number, underline = false): Map<number, CellPaint> {
  const cells = new Map<number, CellPaint>();
  const level = strength * (1 - clamp01(t)) ** 1.6;
  if (level <= 0.01) return cells;
  for (let column = from; column < to; column += 1) cells.set(column, {tint: {color, amount: level}, ...(underline && level > 0.18 ? {underline: true} : {})});
  return cells;
}

/**
 * Prompt morph over one module's final columns: a wipe whose front reveals the
 * settled module; cells ahead of the front are briefly dimmed, a tinted band
 * marks the front. The final geometry is used from the first frame. Only the
 * module's own cells are ever painted.
 */
export function morphCells(from: number, to: number, t: number, color: RgbColor, expressive: boolean, _change: ModuleChange['change'], gain = 1): Map<number, CellPaint> {
  const cells = new Map<number, CellPaint>();
  const width = Math.max(1, to - from);
  const front = from + clamp01(t) * (width + 2);
  for (let column = from; column < to; column += 1) {
    const ahead = column > front;
    const distance = Math.abs(column - front);
    if (ahead) cells.set(column, {dim: true});
    else if (distance < 2.5) cells.set(column, {tint: {color, amount: Math.min(1, (1 - distance / 2.5) * (expressive ? 0.75 : 0.45) * gain)}, ...(expressive ? {bold: true} : {})});
  }
  return cells;
}

export function progress(transition: Transition, now: number): number {
  return clamp01((now - transition.start) / Math.max(1, transition.duration));
}

/**
 * Semantic diff of two prompt module lists (ids, roles, text): only modules
 * whose facts changed, appeared or disappeared. Unchanged modules never move.
 */
export function diffModules(previous: ReadonlyArray<{id: string; text: string; role?: string}>, next: ReadonlyArray<{id: string; text: string; role?: string}>): ModuleChange[] {
  const key = (item: {id: string; role?: string}) => `${item.id}:${item.role ?? ''}`;
  const before = new Map(previous.map(item => [key(item), item]));
  const after = new Map(next.map(item => [key(item), item]));
  const changes: ModuleChange[] = [];
  for (const [id, item] of after) {
    const old = before.get(id);
    if (!old) changes.push({id: item.id, text: item.text, change: 'appeared', ...(item.role ? {role: item.role} : {})});
    else if (old.text !== item.text) changes.push({id: item.id, text: item.text, change: 'changed', ...(item.role ? {role: item.role} : {})});
  }
  for (const [id, item] of before) if (!after.has(id)) changes.push({id: item.id, text: item.text, change: 'disappeared', ...(item.role ? {role: item.role} : {})});
  return changes;
}

/**
 * Rich rendering: the original filled-band look, recovered from 4b04351. Bands are
 * blended against a dark base and set as a cell background (`fill`), so they read
 * strongly on an opaque terminal; on a transparent one they show as a box, which is
 * why Clean is the default.
 */
const RICH_BASE: RgbColor = {red: 18, green: 18, blue: 22};

export function richSweepCells(width: number, t: number, color: RgbColor, strength: number, band = 10): Map<number, CellPaint> {
  const cells = new Map<number, CellPaint>();
  const center = -band + t * (width + band * 2);
  for (let column = Math.max(0, Math.floor(center - band)); column < Math.min(width, Math.ceil(center + band)); column += 1) {
    const falloff = 1 - Math.abs(column - center) / band;
    if (falloff > 0) cells.set(column, {fill: mixRgb(RICH_BASE, color, clamp01(falloff * strength))});
  }
  return cells;
}

export function richDecayCells(from: number, to: number, t: number, color: RgbColor, strength: number): Map<number, CellPaint> {
  const cells = new Map<number, CellPaint>();
  const level = strength * (1 - clamp01(t)) ** 1.6;
  if (level <= 0.01) return cells;
  for (let column = from; column < to; column += 1) cells.set(column, {fill: mixRgb(RICH_BASE, color, Math.min(1, level))});
  return cells;
}

export function richMorphCells(from: number, to: number, t: number, color: RgbColor, expressive: boolean, change: ModuleChange['change'], gain = 1): Map<number, CellPaint> {
  const cells = new Map<number, CellPaint>();
  const width = Math.max(1, to - from);
  const front = from + clamp01(t) * (width + 2);
  for (let column = from; column < to; column += 1) {
    const ahead = column > front;
    const distance = Math.abs(column - front);
    if (ahead) cells.set(column, {fill: mixRgb(RICH_BASE, {red: 0, green: 0, blue: 0}, change === 'disappeared' ? 0.2 : expressive ? 0.5 : 0.35)});
    else if (distance < 2.5) cells.set(column, {fill: mixRgb(RICH_BASE, color, clamp01((1 - distance / 2.5) * (expressive ? 0.75 : 0.5) * gain))});
  }
  return cells;
}

const rich = (look: MotionLook) => look.rendering === 'rich';
const gain = (look: MotionLook, value: number) => Math.min(1, value * look.intensity);

/**
 * The real per-effect paints, shared by the live frame and the /appearance →
 * Motion preview so the two can never drift. Each returns the cells for one
 * logical target row at progress t, drawn by the transition's own look
 * (Clean or Rich) at its own intensity.
 */
export const transitionPaint = {
  /** Command launch over a composer row; `rule` rows (separator, border) take a stronger band. */
  launch: (style: 'sweep' | 'pulse', columns: number, t: number, rule: boolean, look: MotionLook = CLEAN_LOOK) => {
    if (rich(look)) return style === 'sweep' ? richSweepCells(columns, t, UI_COLORS.accent, gain(look, rule ? 0.8 : 0.5)) : richDecayCells(0, columns, t, UI_COLORS.accent, gain(look, 0.35));
    return style === 'sweep' ? sweepCells(columns, t, UI_COLORS.accent, gain(look, rule ? 0.7 : 0.45)) : decayCells(0, columns, t, UI_COLORS.accent, gain(look, 0.3));
  },
  /** Completion highlight over the inserted columns [from, to). */
  materialize: (from: number, to: number, t: number, vivid: boolean, look: MotionLook = CLEAN_LOOK) =>
    rich(look) ? richDecayCells(from, to, t, UI_COLORS.accent, gain(look, vivid ? 0.7 : 0.45)) : decayCells(from, to, t, UI_COLORS.accent, gain(look, vivid ? 0.75 : 0.5), true),
  /** Block Seal over a finished block's header row. */
  seal: (tone: Tone, columns: number, t: number, look: MotionLook = CLEAN_LOOK) => rich(look)
    ? richSweepCells(columns, t, toneColor(tone), gain(look, tone === 'failure' ? 0.75 : 0.55), tone === 'failure' ? 6 : 12)
    : sweepCells(columns, t, toneColor(tone), gain(look, tone === 'failure' ? 0.75 : 0.55), tone === 'failure' ? 6 : 12),
  /** Semantic Echo on a rule row; expressive echoes also sweep the input row. */
  echoRule: (event: SemanticEvent, columns: number, t: number, expressive: boolean, look: MotionLook = CLEAN_LOOK) => rich(look)
    ? richDecayCells(0, columns, t, toneColor(EVENT_TONES[event]), gain(look, expressive ? 0.6 : 0.4))
    : decayCells(0, columns, t, toneColor(EVENT_TONES[event]), gain(look, expressive ? 0.7 : 0.45)),
  echoInput: (event: SemanticEvent, columns: number, t: number, look: MotionLook = CLEAN_LOOK) => rich(look)
    ? richSweepCells(columns, t, toneColor(EVENT_TONES[event]), gain(look, 0.35)) : sweepCells(columns, t, toneColor(EVENT_TONES[event]), gain(look, 0.35)),
  /** Prompt morph over one module's final columns. */
  morph: (from: number, to: number, t: number, expressive: boolean, change: ModuleChange['change'], look: MotionLook = CLEAN_LOOK) =>
    rich(look) ? richMorphCells(from, to, t, UI_COLORS.accent, expressive, change, look.intensity) : morphCells(from, to, t, UI_COLORS.accent, expressive, change, look.intensity),
};
