import type {Key} from '../terminal/keys.js';
import type {Rgb} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import type {Canvas} from './Canvas.js';
import type {EffectsLevel} from './effects.js';
import type {ArcadePalette} from './palette.js';
import type {Rng} from './rng.js';
import type {GameRecordHandle} from './scores.js';

/**
 * The contract between the arcade and a game. A game is a pure state machine plus a renderer: it never reads the
 * clock, the terminal, the filesystem or the global theme itself. Everything it needs arrives in `GameContext`, and
 * everything it draws goes into the `Canvas` it is handed, so the same game runs under the hub, in a test with a fake
 * clock, and in a screenshot.
 */
export type GameKind = 'action' | 'puzzle';

export interface ControlHint { keys: string; action: string }

export interface GameDefinition {
  /** Stable id used in saved records and `/game <id>`: lowercase letters and dashes. */
  id: string;
  /** Other names `/game` accepts for this game (`vespyr-run`, `dino`…). */
  aliases: readonly string[];
  title: string;
  tagline: string;
  description: string;
  kind: GameKind;
  controls: readonly ControlHint[];
  /** What the hub shows next to this game's best result, from its saved record: `Best 1,240 m`. */
  summary(record: Readonly<Record<string, unknown>>): string;
  /** A small looping preview for the hub, drawn into `canvas` at `frame` (a counter at about 10 per second). */
  preview(canvas: Canvas, frame: number, palette: ArcadePalette): void;
  create(context: GameContext): GameInstance;
}

export interface MotionPreferences {
  /** Decorative effects: particles, trails, pops, shake. */
  effects: EffectsLevel;
  /** Reduced motion: no shake, no flashes, no full-screen transitions. */
  reduced: boolean;
}

export interface GameContext {
  /** Playfield size in cells. A game must cope with any size from 20 x 8 up, and `resize` changes it later. */
  size: {columns: number; rows: number};
  /** Seed for this run (a new one every run, a saved one when a game resumes). */
  seed: number;
  rng: Rng;
  motion: MotionPreferences;
  color: ColorLevel;
  safeGlyphs: boolean;
  /** The saved record for this game (read and written through the arcade's validated store). */
  record: GameRecordHandle;
  /** The arcade's clock in milliseconds; tests drive it by hand. */
  now(): number;
}

export type GameStatus = 'ready' | 'playing' | 'paused' | 'over' | 'won';

export interface GameResult {
  /** The headline number: score, distance or seconds. */
  score: number;
  /** How it is shown (`1,240`, `3:07`). */
  scoreText: string;
  /** A new best for the person; the game over screen celebrates it. */
  record: boolean;
  /** Lines under the score (`Distance 420 m`, `Passed 18`). */
  details: readonly string[];
}

export type GameKeyResult = 'handled' | 'ignored' | 'back' | 'exit';

export interface GameInstance {
  readonly status: GameStatus;
  /** Set when status is `over` or `won`. */
  readonly result: GameResult | undefined;
  /** The game wants fixed steps at this rate while playing (60 for action games, 0 for turn-based). */
  readonly stepsPerSecond: number;
  /** The game wants a repaint at least every this many ms while visible (a timer, an idle animation); 0 for none. */
  readonly refreshMs: number;
  /** Advance the simulation by exactly `dtMs` (one fixed step). Called only while `playing`. */
  step(dtMs: number): void;
  /** Called on every frame whatever the status, with real elapsed time, for purely visual timers (idle blinks). */
  animate(dtMs: number): void;
  /** One key. `back` returns to the hub (or pauses first), `exit` leaves the arcade. */
  key(key: Key): GameKeyResult;
  /** Draw the whole playfield and HUD. `alpha` is the interpolation toward the next step (0..1). */
  render(canvas: Canvas, alpha: number, palette: ArcadePalette): void;
  resize(size: {columns: number; rows: number}): void;
  pause(): void;
  /** Control hints for the footer in the current state. */
  hints(): readonly ControlHint[];
  /** Save whatever persists (a puzzle in progress). Called when the person leaves. */
  persist(): void;
  dispose(): void;
}

export type { Rgb };
